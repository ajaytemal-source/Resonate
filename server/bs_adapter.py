import asyncio
import numpy as np
import logging
import os
import aiohttp

import audio_utils

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ToneAnalyzer:
    def __init__(self):
        
        self.client_id = os.getenv("BEHAVIORAL_SIGNALS_API_CID", "")
        self.api_key = os.getenv("BEHAVIORAL_SIGNALS_API_KEY", "")
        self.base_url = (os.getenv("BEHAVIORAL_SIGNALS_API_BASE_URL", "https://api.behavioralsignals.com/v5")).rstrip("/")
        self.endpoint = f"{self.base_url}/clients/{self.client_id}/processes/audio"
        self.status_base = f"{self.base_url}/clients/{self.client_id}/processes"
        self.target_sample_rate = 16000
        
        # Store last request/response details 
        self.last_status_code = None
        self.last_duration_ms = None
        self.last_raw_response = None

        # Feedback handler
        self.feedback_handler = None  
        self.last_feedback = {}
 
    #Send a single feedback metric to the feedback panel
    def send_metric(self, task: str, final_label: str, meta: dict):
        
        payload = {
            "task": task,
            "finalLabel": final_label,
        }

        if meta:
            payload.update(meta)
        # Cache the last finalLabel per task for potential downstream consumers
        try:
            self.last_feedback[task] = final_label
        except Exception:
            pass
        # Dispatch to external handler if configured; otherwise log
        try:
            if callable(self.feedback_handler):
                self.feedback_handler(task, final_label, meta or {})
            else:
                logger.info(f"Behavioral Signals Feedback: {payload}")
        except Exception as e:
            logger.warning(f"Feedback dispatch failed for task={task}: {e}")

    #Process/Parse results from BS Poll. Extract finalLabel from each task result and emit feedback.
    def process_results(self, results_data: dict):
        results = results_data.get("results")
        for item in results:
            if not isinstance(item, dict):
                continue
            task = item.get("task")
            if not task or str(task).lower() == "asr":
                continue
            final_label = item.get("finalLabel")
            if final_label is None:
                continue
            meta = {
                "startTime": item.get("startTime"),
                "endTime": item.get("endTime"),
                "level": item.get("level"),
                "id": item.get("id"),
            }
            self.send_metric(str(task), str(final_label), meta)
    
    #Post/Poll BS for tone analysis
    async def analyze_chunk(self, audio_chunk: np.ndarray) -> dict:

        wav_bytes = audio_utils.numpy_to_wav_bytes(audio_chunk).getvalue()
        headers = {
            "X-Auth-Token": self.api_key,
            "Accept": "application/json",
        }

        process_id = None
        last_data = None

        # Create process/Post Request
        async with aiohttp.ClientSession() as session:
            form = aiohttp.FormData()
            form.add_field("file", wav_bytes, filename="audio.wav", content_type="audio/wav")
            async with session.post(self.endpoint, headers=headers, data=form, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                data = await resp.json()
                process_id = data.get("pid")

            # Poll process status for every 0.5 seconds for up to 10 seconds
            status_url = f"{self.status_base}/{process_id}"
            for attempt in range(20):
                await asyncio.sleep(0.5)
                async with session.get(status_url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as poll_resp:
                    if poll_resp.status >= 400:
                        continue
                    last_data = await poll_resp.json()
                    status = last_data.get("status")
                    if status == 2:
                        results_url = f"{self.status_base}/{process_id}/results"
                        # Poll process results 
                        async with session.get(results_url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as results_resp:
                            if results_resp.status >= 400:
                                break
                            results_data = await results_resp.json()
                            self.process_results(results_data)
                        break