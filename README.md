# Resonate

Resonate, is an AI-powered real-time speech coach designed to help people communicate more effectively — offering gentle, adaptive feedback based on tone, pacing, and confidence. Users can select their intended tone, conversation setting, and audience, which are then used to provide tailored, real-time feedback. 

---

## Inspiration

Language is nuanced. The way we speak, listen, and interpret can vary so much from person to person. Due to this, there tends to be this invisible barrier between what we intend on communicating and what others perceive. When we miss conversational cues, get tunnel vision, misinterpret tone and intent, this harms our ability to collaborate and weaken our mutual understanding. Despite the unique perspectives and expertise we bring to each interaction, our voices can be the very thing that stops them from being fully realized. And if you’ve ever tried to stay be aware of how you’re speaking on top of listening and responding, you likely know how distracting and draining that can be. 

I’ve often struggled with speech myself, especially under pressure. And I know I'm not alone. Building this was a way to turn that challenge into something that could help others find their voice too.

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
