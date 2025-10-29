import { useEffect, useState, useRef } from 'react'
import AudioLeft from './assets/AudioLeft.svg'
import AudioRight from './assets/AudioRight.svg'
import Select from 'react-select'
import { useWebSocket } from './WS_Connect';
import './App.css'

function App() {

  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationTone, setConversationTone] = useState('');
  const [conversationPurpose, setConversationPurpose] = useState('');
  const [audienceType, setAudienceType] = useState('');
  const [aiFeedback, setAiFeedback] = useState('');
  const [aiFeedbackWords, setAiFeedbackWords] = useState([]);
  const [aiAnimPhase, setAiAnimPhase] = useState('idle'); // 'idle' | 'fadingOut' | 'fadingIn'
  const [aiAnimKey, setAiAnimKey] = useState(0);
  const [aiPanelFlash, setAiPanelFlash] = useState(false);
  const [aiHasLoaded, setAiHasLoaded] = useState(false);
  const aiFlashTimerRef = useRef(null);
  const [showTitle, setShowTitle] = useState(false);
  const [showSlogan, setShowSlogan] = useState(false);
  const [showTone, setShowTone] = useState(false);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const streamIdRef = useRef('user1');
  const messagesContainerRef = useRef(null);
  const prevTranscriptCountRef = useRef(0);
  
  // Initialize WebSocket connection
  const { messages, sendMessage, sendBinary, isConnected, clearMessages } = useWebSocket('ws://localhost:8766');

  const startListening = async () => {
    if (isStreaming || !isConnected || !conversationTone) return;
    try {
      // Create and/or resume audio context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Prepare mic stream
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
      mediaStreamRef.current = mediaStream;

      // Load worklet
      await audioContextRef.current.audioWorklet.addModule(new URL('./worklets/micProcessor.js', import.meta.url));

      // Nodes
      const source = audioContextRef.current.createMediaStreamSource(mediaStream);
      sourceNodeRef.current = source;
      const worklet = new AudioWorkletNode(audioContextRef.current, 'mic-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: {
          targetSampleRate: 16000,
          chunkMs: 20,
        }
      });
      workletNodeRef.current = worklet;

      // Stream mulaw chunks over WebSocket as binary
      worklet.port.onmessage = (event) => {
        const chunk = event.data; // Uint8Array of mulaw bytes
        if (chunk && chunk.byteLength) {
          sendBinary(chunk).catch(() => {/* ignore transient errors */});
        }
      };

      // Connect graph (no output)
      source.connect(worklet);

      // Announce stream start
      await sendMessage({
        type: 'stream_start',
        stream_id: streamIdRef.current,
        encoding: 'mulaw',
        sample_rate: 16000,
        channels: 1,
        timestamp: Date.now(),
        user_intent: conversationTone,
        user_purpose: conversationPurpose,
        audience_type: audienceType,
      });

      setIsStreaming(true);
    } catch (err) {
      console.error('Error starting microphone stream:', err);
    }
  };

  // Load saved tone on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('conversationTone');
      if (saved) setConversationTone(saved);
      const savedPurpose = localStorage.getItem('conversationPurpose');
      if (savedPurpose) setConversationPurpose(savedPurpose);
      const savedAudience = localStorage.getItem('audienceType');
      if (savedAudience) setAudienceType(savedAudience);
    } catch {}
  }, []);

  // Initial hero reveal sequencing
  useEffect(() => {
    setShowTitle(true);
    const t1 = setTimeout(() => setShowSlogan(true), 500);
    const t2 = setTimeout(() => setShowTone(true), 1000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Watch for AI feedback messages and animate
  useEffect(() => {
    try {
      const last = [...messages].reverse().find(m => m && m.type === 'ai_feedback' && m.feedback);
      if (!last) return;
      const text = String(last.feedback || '').trim();
      if (!text || text === aiFeedback) return;

      let outTimer;

      const triggerFlash = () => {
        // Cancel any pending timer, toggle class off, then on next frame re-add to retrigger CSS animation
        if (aiFlashTimerRef.current) {
          clearTimeout(aiFlashTimerRef.current);
          aiFlashTimerRef.current = null;
        }
        setAiPanelFlash(false);
        requestAnimationFrame(() => {
          setAiPanelFlash(true);
          aiFlashTimerRef.current = setTimeout(() => setAiPanelFlash(false), 500);
        });
      };

      if (!aiHasLoaded) {
        // Initial load: run fade animation and per-word reveal
        setAiAnimPhase('fadingOut');
        outTimer = setTimeout(() => {
          const words = text.split(/\s+/);
          setAiFeedback(text);
          setAiFeedbackWords(words);
          setAiAnimPhase('fadingIn');
          setAiAnimKey(k => k + 1); // remount to restart animations
          triggerFlash();
          setAiHasLoaded(true);
        }, 250);
      } else {
        // Subsequent updates: no fade animation, just update text
        const words = text.split(/\s+/);
        setAiFeedback(text);
        setAiFeedbackWords(words);
        setAiAnimPhase('idle');
        // Retrigger backdrop flash on each update
        triggerFlash();
      }

      return () => {
        if (outTimer) clearTimeout(outTimer);
        if (aiFlashTimerRef.current) {
          clearTimeout(aiFlashTimerRef.current);
          aiFlashTimerRef.current = null;
        }
      };
    } catch {}
  }, [messages, aiFeedback, aiHasLoaded]);

  // Log BS updates to console for visibility
  useEffect(() => {
    try {
      const updates = messages.filter(m => m && m.type === 'bs_update');
      if (updates.length > 0) {
        const last = updates[updates.length - 1];
        // eslint-disable-next-line no-console
        console.log('Behavioral Signals update:', last);
      }
    } catch {}
  }, [messages]);

  // Auto-scroll transcript container when new transcript arrives
  useEffect(() => {
    try {
      const count = messages.filter((m) => m && (m.text || m.transcript || (m.llm && m.llm.transcription && m.llm.transcription.text))).length;
      if (count > prevTranscriptCountRef.current) {
        const el = messagesContainerRef.current;
        if (el) {
          // Scroll to bottom after DOM paints
          requestAnimationFrame(() => {
            el.scrollTop = el.scrollHeight;
          });
        }
      }
      prevTranscriptCountRef.current = count;
    } catch {}
  }, [messages]);

  const stopListening = async () => {
    if (!isStreaming) return;
    try {
      // Stop worklet and disconnect
      try {
        sourceNodeRef.current?.disconnect();
      } catch {}
      try {
        workletNodeRef.current?.port.close();
      } catch {}
      try {
        workletNodeRef.current?.disconnect();
      } catch {}
      workletNodeRef.current = null;
      sourceNodeRef.current = null;

      // Stop media tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }

      // Send stream end
      await sendMessage({
        type: 'stream_end',
        stream_id: streamIdRef.current,
        timestamp: Date.now()
      });

    } catch (err) {
      console.error('Error stopping microphone stream:', err);
    } finally {
      setIsStreaming(false);
      // Reset panels: clear transcripts and AI feedback
      try { clearMessages(); } catch {}
      setAiFeedback('');
      setAiFeedbackWords([]);
      setAiAnimPhase('idle');
      setAiAnimKey(0);
    }
  };

  return (
    <div className={`app ${isStreaming ? 'streaming' : ''}`}>
      {/* Header removed per request */}

      {!isStreaming ? (
        <section className="conversation-selection">
          <div className="hero">
            <h1 className={`hero-title ${showTitle ? 'show' : 'hidden'}`}>Resonate</h1>
            <p className={`hero-slogan ${showSlogan ? 'show' : 'hidden'}`}>Helping You Communicate Better, Connect Deeper — in Real Time.</p>
          </div>
          {showTone && (
            <div className="tone-select" style={{ width: '100%', marginBottom: '1rem' }}>
              <label htmlFor="conversationTone" style={{ display: 'block', marginBottom: '0.5rem', color: '#2d3748', fontWeight: 600 }}>Set the Tone.</label>
              <Select
                inputId="conversationTone"
                className="react-select-container"
                classNamePrefix="react-select"
                placeholder="Select tone..."
                menuPortalTarget={document.body}
                menuPosition="fixed"
                styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
                options={[
                  { value: 'Professional / Formal', label: 'Professional / Formal' },
                  { value: 'Friendly / Casual', label: 'Friendly / Casual' },
                  { value: 'Persuasive / Convincing', label: 'Persuasive / Convincing' },
                  { value: 'Informative / Explanatory', label: 'Informative / Explanatory' },
                  { value: 'Supportive / Empathetic', label: 'Supportive / Empathetic' },
                  { value: 'Humorous / Lighthearted', label: 'Humorous / Lighthearted' },
                  { value: 'Neutral / Objective', label: 'Neutral / Objective' },
                ]}
                value={conversationTone ? { value: conversationTone, label: conversationTone } : null}
                onChange={(opt) => {
                  const v = opt?.value || '';
                  setConversationTone(v);
                  try { localStorage.setItem('conversationTone', v); } catch {}
                }}
                isClearable
              />
            </div>
          )}
          {showTone && (
            <div className="tone-select" style={{ width: '100%', marginBottom: '1rem' }}>
              <label htmlFor="conversationPurpose" style={{ display: 'block', marginBottom: '0.5rem', color: '#2d3748', fontWeight: 600 }}>Set the stage.</label>
              <Select
                inputId="conversationPurpose"
                className="react-select-container"
                classNamePrefix="react-select"
                placeholder="Select purpose..."
                menuPortalTarget={document.body}
                menuPosition="fixed"
                styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
                options={[
                  { value: 'Pitch', label: 'Pitch' },
                  { value: 'Interview', label: 'Interview' },
                  { value: 'Presentation', label: 'Presentation' },
                  { value: 'Debate', label: 'Debate' },
                  { value: 'Support Call', label: 'Support Call' },
                  { value: 'Casual Chat', label: 'Casual Chat' },
                ]}
                value={conversationPurpose ? { value: conversationPurpose, label: conversationPurpose } : null}
                onChange={(opt) => {
                  const v = opt?.value || '';
                  setConversationPurpose(v);
                  try { localStorage.setItem('conversationPurpose', v); } catch {}
                }}
                isClearable
              />
            </div>
          )}
          {showTone && (
            <div className="tone-select" style={{ width: '100%', marginBottom: '1rem' }}>
              <label htmlFor="audienceType" style={{ display: 'block', marginBottom: '0.5rem', color: '#2d3748', fontWeight: 600 }}>Set the audience.</label>
              <Select
                inputId="audienceType"
                className="react-select-container"
                classNamePrefix="react-select"
                placeholder="Select audience..."
                menuPortalTarget={document.body}
                menuPosition="fixed"
                styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
                options={[
                  { value: 'Coworker', label: 'Coworker' },
                  { value: 'Manager', label: 'Manager' },
                  { value: 'Client', label: 'Client' },
                  { value: 'Stranger', label: 'Stranger' },
                  { value: 'Friend', label: 'Friend' },
                ]}
                value={audienceType ? { value: audienceType, label: audienceType } : null}
                onChange={(opt) => {
                  const v = opt?.value || '';
                  setAudienceType(v);
                  try { localStorage.setItem('audienceType', v); } catch {}
                }}
                isClearable
              />
            </div>
          )}
          {!!conversationTone && !!conversationPurpose && !!audienceType && (
            <button onClick={startListening} disabled={!isConnected || isStreaming || !conversationTone || !conversationPurpose || !audienceType}>
              Start Live Session
            </button>
          )}
        </section>
      ) : (
        <>
        <div className="panels-row">
          <section className="feedback-dashboard">
            <h2>Transcript & Voice Analysis</h2>
            {messages.filter((m) => m && (m.text || m.transcript || (m.llm && m.llm.transcription && m.llm.transcription.text))).length > 0 ? (
              <div className="messages" ref={messagesContainerRef}>
                {messages
                  .filter((m) => m && (m.text || m.transcript || (m.llm && m.llm.transcription && m.llm.transcription.text)))
                  .map((msg, index) => (
                  <div key={index} className="message">
                    {
                      // Transcription result
                      <div className="transcription-result">
                        <div className="transcription-header">
                          <span className="timestamp">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="transcription-text">
                          {(msg.transcript || msg.text || (msg.llm && msg.llm.transcription && msg.llm.transcription.text) || '')}
                        </div>
                        {/* Voice analysis (feedback metrics only) */}
                        {(() => {
                          const feedback = msg.feedback || {};
                          const order = ['emotion','positivity','strength','speaking_rate','hesitation','engagement'];
                          const entries = order
                            .filter((k) => feedback[k] !== undefined && feedback[k] !== null)
                            .map((k) => [k, feedback[k]]);
                          if (entries.length === 0) return null;
                          return (
                            <div className="feedback-details" style={{ marginTop: '0.5rem', color: '#cfcfcf' }}>
                              <strong>Voice analysis:</strong>
                              <div className="feedback-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.4rem', marginTop: '0.35rem' }}>
                                {entries.map(([k, v]) => (
                                  <div key={k} className="feedback-item" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', background: 'rgba(255,255,255,0.06)', padding: '0.35rem 0.5rem', borderRadius: '6px' }}>
                                    <span className="feedback-key" style={{ color: '#a0a0a0', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}</span>
                                    <span className="feedback-value" style={{ color: '#ffffff' }}>{String(v)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                        {/* Behavioral Signals meta hidden per request */}
                        {/* Removed per-word timestamp chips */}
                      </div>
                    }
                  </div>
                ))}
              </div>
            ) : (
              <div className="feedback-placeholder">Listening…</div>
            )}
          </section>
          <section className={`ai-feedback-panel ${aiPanelFlash ? 'flash-backdrop' : ''}`}>
            <h2>AI Feedback</h2>
            <div className="ai-feedback-container">
              {aiFeedbackWords.length > 0 ? (
                <div className={`ai-feedback ${aiAnimPhase}`} key={aiAnimKey}>
                  {aiFeedbackWords.map((w, i) => (
                    <span
                      key={`${w}-${i}-${aiAnimKey}`}
                      className="ai-word"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    >
                      {w}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="feedback-placeholder">Analyzing…</div>
              )}
            </div>
          </section>
        </div>
        <div className="panels-actions">
          <button onClick={stopListening} className="stop-button">
            End Session
          </button>
        </div>
        </>
      )}
      {/* Left-center decorative audio icon */}
      <img src={AudioLeft} alt="Audio" className="side-audio-left" />
      {/* Right-center decorative audio icon */}
      <img src={AudioRight} alt="Audio" className="side-audio-right" />
    </div>
  );

}

export default App
