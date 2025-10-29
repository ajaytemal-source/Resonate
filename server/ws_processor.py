import asyncio
import json
import numpy as np
import logging
import time
import os
from openai import OpenAI

from whisp_adapter import Transcriber
from bs_adapter import ToneAnalyzer
from audio_utils import mulaw_to_linear
import past_speech_sessions

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WebSocketProcessor:
    def __init__(self, websocket, transcriber: Transcriber, tone_analyzer: ToneAnalyzer):
        self.websocket = websocket
        self.transcriber = transcriber
        self.tone_analyzer = tone_analyzer
        self.segments = {}
        self.segmentCount = 0


        self.stream_id = None
        self.audio_buffer = []
        # Processing chunk size for Whisper input
        self.min_chunk_samples = 160000  # 10.0 seconds at 16kHz
        self.sample_rate = 16000

        #User Speech Selections
        self.user_intent = None
        self.user_purpose = None
        self.user_audience = None

        # Conversation accumulators
        self.total_transcript = ""
        self.gpt_responses = []

        # Behavioral Signals: trigger after 6s for each 10s window
        self.bs_analysis_window = int(6.0 * self.sample_rate)
        self.bs_started_for_current_window = False

    #Async call to gpt-4-turbo 
    # TODO: Refactor this section (handle_gpt_feedback & request_gpt_feedback) into own class.
    async def handle_gpt_feedback(self, llm_payload: dict):

        feedback = await asyncio.to_thread(self.request_gpt_feedback, llm_payload)
            
        if isinstance(feedback, str) and feedback.strip():
            # Store in response history
            self.gpt_responses.append(feedback.strip())

        await self.websocket.send(json.dumps({
            'type': 'ai_feedback',
            'feedback': feedback,
            'user_intent': llm_payload.get('user_intent'),
            'timestamp': int(time.time() * 1000),
        }))

    def request_gpt_feedback(self, llm_payload: dict) -> str:
        
        if OpenAI is None:
            return ""
        try:
            client = OpenAI()
        except Exception as e:
            logger.warning(f"OpenAI client init failed: {e}")
            return ""

        try:
            # Build prompt per requirements
            user_selected_tone = llm_payload.get('user_intent')
            combined_json = llm_payload
            
            # Derive fields expected by the prompt
            user_purpose = llm_payload.get('user_purpose') or (self.user_purpose or '')
            user_audience = llm_payload.get('audience_type')
            previous_feedback = llm_payload.get('gpt_responses')
            full_transcript = llm_payload.get('total_transcript') or (self.total_transcript or '')

            #GPT PROMPT
            prompt = (
                "You are an AI speech coach providing **real-time emotional and behavioral feedback**. "
                "Analyze the user's **most recent spoken segment** and behavioral metrics to understand their overall **emotional state, focus, and delivery approach**, rather than individual word choices. "
                "Consider how their tone, pacing, and energy align with their intended tone, purpose, and audience. "
                "Use the **total transcript so far** and your previous feedback for continuity, but base your response **only on what was just said**. "
                "If the user has incorporated previous advice or shows signs of improvement, **reinforce that progress with clear, affirming feedback** that strengthens confidence and self-trust. "
                "If emotional cues suggest hesitation, tension, or low confidence, provide **emotionally supportive and grounding feedback** that helps the user re-center — for example, gentle cues like taking a breath, pausing, or slowing down. "
                "If the user appears to be drifting away from their intended purpose, tone, or audience focus, offer a **polite, nonjudgmental reminder** to help them realign with their goal — for instance, suggesting they refocus or reconnect with their main message. "
                "Avoid harsh correction or technical critique. "
                "Keep feedback concise, compassionate, and immediately grounding, focusing on maintaining emotional steadiness and conversational alignment.\n\n"
                "User-selected tone: {user_selected_tone}\n"
                "User purpose: {user_purpose}\n"
                "Audience: {user_audience}\n"
                "Current segment data: {combined_json}\n"
                "Previous GPT feedback: {previous_feedback}\n"
                "Total transcript so far: {full_transcript}"
            ).format(
                user_selected_tone=user_selected_tone,
                user_purpose=user_purpose,
                user_audience=user_audience,
                combined_json=json.dumps(combined_json, ensure_ascii=False),
                previous_feedback=json.dumps(previous_feedback, ensure_ascii=False),
                full_transcript=json.dumps(full_transcript, ensure_ascii=False)
            )

            #Send prompt to gpt-4-turbo, recieve response in resp
            resp = client.chat.completions.create(
                model=os.getenv("OPENAI_GPT4_TURBO_MODEL", "gpt-4o-mini"),
                messages=[
                    {"role": "system", "content": "You are an AI speech coach."},
                    {"role": "user", "content": f"{prompt}\n\nKeep feedback no more than 5 words."},
                ],
                temperature=0.2,
                max_tokens=16,
            )
            
            text = resp.choices[0].message.content
            return text
            
        except Exception as e:
            logger.warning(f"OpenAI feedback request failed: {e}")
            return ""

    #Process raw mulaw bytes (binary WebSocket frame)
    async def process_audio_bytes(self, mulaw_bytes):
        try:
            # Convert mulaw to linear PCM
            pcm_data = mulaw_to_linear(mulaw_bytes)
            # Convert to float32 and normalize
            audio_float = pcm_data.astype(np.float32) / 32768.0
            # Buffer
            self.audio_buffer.extend(audio_float)
            
            # Schedule BS as soon as we have the trigger window in the current buffer
            if not self.bs_started_for_current_window and len(self.audio_buffer) >= self.bs_analysis_window:
                bs_chunk = np.array(self.audio_buffer[:self.bs_analysis_window])

                end_ts_ms = int(time.time() * 1000)
                bs_window_ms = int((self.bs_analysis_window / float(self.sample_rate)) * 1000)
                start_ts_ms = max(0, end_ts_ms - bs_window_ms)
                
                asyncio.create_task(self.process_bs_chunk(bs_chunk, start_ts_ms, end_ts_ms))
                self.bs_started_for_current_window = True
                logger.info(f"BS chunk scheduled (binary): start={start_ts_ms} end={end_ts_ms} samples={len(bs_chunk)}")
            
            # Process when enough samples are collected
            if len(self.audio_buffer) >= self.min_chunk_samples:

                #Sliding Window used to retain a small portion of previous audio chunk to preserve context
                audio_chunk = np.array(self.audio_buffer[:self.min_chunk_samples])
                overlap_samples = int(0.1 * self.sample_rate)
                self.audio_buffer = self.audio_buffer[self.min_chunk_samples - overlap_samples:]
                # Reset BS flag for the next 10s window
                self.bs_started_for_current_window = False
                # Transcribe (10s window)
                text = await asyncio.to_thread(self.transcriber.transcribe_chunk, audio_chunk)

                if text.strip():
                    logger.info(f"Transcription: {text}")
                    # Accumulate total transcript
                    cleaned = str(text).strip()
                    if cleaned:
                        self.total_transcript += " " + cleaned
                    llm_obj = self.assemble_llm_input(text)
                    asyncio.create_task(self.handle_gpt_feedback(llm_obj))
                    return {
                        'stream_id': self.stream_id or 'unknown',
                        'timestamp': int(time.time() * 1000),
                        'transcript': text,
                        'feedback': dict(self.tone_analyzer.last_feedback or {}),
                        'behavioral_signals': {
                            'client_id': self.tone_analyzer.client_id,
                            'endpoint': self.tone_analyzer.endpoint,
                            'status_code': self.tone_analyzer.last_status_code,
                            'duration_ms': self.tone_analyzer.last_duration_ms,
                            'raw': self.tone_analyzer.last_raw_response,
                        },
                        'text': text,
                        'llm': llm_obj,
                    }




            return None
        except Exception as e:
            logger.error(f"Error processing binary audio: {e}")
            return None
    
    #Start BS processing for a 6s chunk and update latest results on completion.
    async def process_bs_chunk(self, bs_chunk: np.ndarray, start_ts_ms: int, end_ts_ms: int):
        try:
            await self.tone_analyzer.analyze_chunk(bs_chunk)

            # Send BS results to client console (frontend) 
            try:
                await self.websocket.send(json.dumps({
                    'type': 'bs_update',
                    'chunk': {
                        'start_ms': start_ts_ms,
                        'end_ms': end_ts_ms,
                    },
                    'feedback': dict(self.tone_analyzer.last_feedback or {}),
                    'behavioral_signals': {
                        'client_id': self.tone_analyzer.client_id,
                        'endpoint': self.tone_analyzer.endpoint,
                        'status_code': self.tone_analyzer.last_status_code,
                        'duration_ms': self.tone_analyzer.last_duration_ms,
                        'raw': self.tone_analyzer.last_raw_response,
                    },
                }))
            except Exception as send_err:
                logger.warning(f"Failed to send bs_update to client: {send_err}")
        except Exception as e:
            logger.warning(f"BS processing error: {e}")

    #Merge Whisper transcription and BS tone analysis into a single JSON 
    def assemble_llm_input(self, transcript_text: str) -> dict:

        # Construct unified payload
        # TODO: Include raw prediction scores in the payload
        llm_payload = {
            "transcription": {
                "text": transcript_text
            },
	        "user_intent": self.user_intent,
            "user_purpose": self.user_purpose,
            "audience_type": self.user_audience,
            "total_transcript": self.total_transcript,
            "gpt_responses": list(self.gpt_responses),
            "voice_analysis": self.tone_analyzer.last_feedback,
        }

        return llm_payload

    #Handle incoming WebSocket message
    async def handle_message(self, message):
        try:

            # Treat any non-text frame as binary mulaw
            if not isinstance(message, str):
                # Ensure bytes
                if isinstance(message, (bytes, bytearray)):
                    binary_data = message
                else:
                    binary_data = bytes(message)
                result = await self.process_audio_bytes(binary_data)
                if result:
                    await self.websocket.send(json.dumps(result))
                return

            # Text frames: JSON control or legacy payloads
            payload = json.loads(message)

            # Control: 
            if isinstance(payload, dict) and payload.get('type') == 'stream_start':
                self.stream_id = payload.get('stream_id', 'unknown')
                self.sample_rate = int(payload.get('sample_rate', 16000))
                self.user_intent = payload.get('user_intent')
                self.user_purpose = payload.get('user_purpose')
                self.user_audience = payload.get('audience_type')
            
            # Handle stream end signal
            if isinstance(payload, dict) and payload.get('type') == 'stream_end':
                await self.websocket.send(json.dumps({
                    'type': 'stream_complete',
                    'message': 'Audio stream processing complete'
                }))
                return
                     
        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
        except Exception as e:
            logger.error(f"Error handling message: {e}")