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