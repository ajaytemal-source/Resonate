# Resonate

Resonate is an AI-powered real-time speech coach designed to help people communicate more effectively — offering gentle, adaptive feedback based on tone, pacing, and confidence. Users can select their intended tone, conversation setting, and audience, which are then used to provide tailored, real-time feedback. 

This project won first place at Hiya’s AI Voice Innovation Challenge at NYU.

---

## Inspiration & Mission

Language is nuanced. The way we speak, listen, and interpret can vary so much from person to person. Due to this, there tends to be this invisible barrier between what we intend on communicating and what others perceive. When we miss conversational cues, get tunnel vision, misinterpret tone and intent, this harms our ability to collaborate and weaken our mutual understanding. Despite the unique perspectives and expertise we bring to each interaction, our voices can be the very thing that stops them from being fully realized. And if you’ve ever tried to stay be aware of how you’re speaking on top of listening and responding, you likely know how distracting and draining that can be. 

I’ve often struggled with speech myself, especially under pressure, and I know I’m not alone. Many people hold back from communicating, not because they have nothing to say, but because they fear they won’t be understood. The goal of Resonate is to support those who struggle, helping them express what they want to communicate. As I continue developing Resonate, that goal will always guide my work. 

## Tech Stack

Backend: Python WebSocket server for bi-directional audio streaming and real-time communication.

APIs: Integrated OpenAI Whisper for speech-to-text and Behavioral Signals API for tonal and emotional analysis.

LLM Integration: GPT-4-Turbo used to generate context-aware, conversational feedback based on analysis results.

Frontend: Developed in React (Vite) with a JavaScript WebSocket client to receive live feedback from the backend.

Pipeline: Captured user audio → transmitted via WebSocket → processed by Whisper & Behavioral Signals → analyzed and summarized by GPT-4-Turbo → feedback streamed back to the client UI.

---

## Installation

### Backend Dependencies
```bash
pip install -r requirements.txt
```

### Frontend Dependencies
```bash
cd client
npm install
```

---

## Environment Variables

Set the following keys in your environment before running the server:

Note: Signing up for the Behavioral Signals API provides 120 minutes of free usage.


```bash
export BEHAVIORAL_SIGNALS_API_KEY=<your_key>
export BEHAVIORAL_SIGNALS_API_CID=<your_cid>
export OPENAI_API_KEY=<your_key>
```

---

## Quick Start

### Run the Backend Server
```bash
python ws_server.py
```

### Run the Frontend Client
```bash
cd client
npm run dev
```
