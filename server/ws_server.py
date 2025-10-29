import asyncio
import websockets
import numpy as np
import logging

from whisp_adapter import Transcriber
from bs_adapter import ToneAnalyzer
from ws_processor import WebSocketProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def handler(websocket):
    logger.info(f"Client connected: {websocket.remote_address}")
    try:

        transcriber = Transcriber()
        tone_analyzer = ToneAnalyzer()
        processor = WebSocketProcessor(websocket, transcriber, tone_analyzer)

        # Process messages
        async for message in websocket:
            await processor.handle_message(message)

    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"Error in handler: {e}")

async def main():
    logger.info("Starting WebSocket server...")

    async with websockets.serve(handler, "localhost", 8766):
        logger.info("WebSocket server started on ws://localhost:8766")
        logger.info("Ready to receive audio streams")
        await asyncio.Future() 

if __name__ == "__main__":
    asyncio.run(main())