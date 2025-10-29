import numpy as np
import io
import wave

# Mulaw to PCM conversion (audioop library is deprecated)
def mulaw_to_linear(mulaw_bytes):

    # Convert bytes to numpy array of uint8
    mulaw_data = np.frombuffer(mulaw_bytes, dtype=np.uint8)
    
    # Mulaw to linear conversion
    sign = ((mulaw_data & 0x80) != 0).astype(np.int16)
    exponent = ((mulaw_data >> 4) & 0x07).astype(np.int16)
    mantissa = (mulaw_data & 0x0F).astype(np.int16)
    
    # Reconstruct linear value
    linear = np.zeros_like(mulaw_data, dtype=np.int16)
    linear = (mantissa << (exponent + 3)) + 0x84
    linear = np.where(sign, -linear, linear)
    
    return linear

# Converts a numpy array into wav byte format
def numpy_to_wav_bytes(audio_chunk: np.ndarray, target_sample_rate: int = 16000):
    audio = np.asarray(audio_chunk, dtype=np.float32)
    if audio.ndim != 1:
        audio = audio.reshape(-1)
    audio = np.clip(audio, -1.0, 1.0)
    pcm16 = (audio * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit PCM
        wf.setframerate(target_sample_rate)
        wf.writeframes(pcm16.tobytes())
    return buf