import numpy as np
import logging
import os
from openai import OpenAI

import audio_utils

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class Transcriber:
    def __init__(self, target_sample_rate=16000):
        self.target_sample_rate = target_sample_rate
        self.model_name = os.getenv("OPENAI_WHISPER_MODEL", "whisper-1")
        self._client = None

        if OpenAI is not None:
            try:
                self._client = OpenAI() 
            except Exception as e:
                logger.error(f"Failed to initialize OpenAI client: {e}")

    def transcribe_chunk(self, audio_chunk: np.ndarray) -> str:

        wav_buf = audio_utils.numpy_to_wav_bytes(audio_chunk)
        wav_buf.name = 'audio.wav'
        wav_buf.seek(0)

        try:
            # Post Request
            resp = self._client.audio.transcriptions.create(
                model=self.model_name,
                file=wav_buf,
            )

            transcript = getattr(resp, 'text', None)
            return transcript
        
        except Exception as e:
            logger.error(f"OpenAI transcription failed: {e}")
            return ""