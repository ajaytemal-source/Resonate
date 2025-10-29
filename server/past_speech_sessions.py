
class SpeechSegment: 
    def __init__(self, transcription : str, tone_analysis, id):
        self.id = id
        self.tone_analysis = tone_analysis
        self.transcription = transcription

class TotalSession:
    def __init__(self, speech_segments, id):
        self.id 
        self.speech_segments = speech_segments 

sessions = {}

def getSession(id):
    return sessions[id]
