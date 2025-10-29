import { useEffect, useRef, useState } from "react";

export function useWebSocket(url) {
  const ws = useRef(null);

  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    console.log('Creating WebSocket connection to:', url);
    //Create WebSocket connection
    ws.current = new WebSocket(url);
    
    ws.current.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    //Message received from server
    ws.current.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);
        console.log("Raw Mesage" + parsedData); 
        setMessages((prev) => {
          const newMessages = [...prev, parsedData];
          
          // Keep only last 50 messages to prevent memory issues
          return newMessages.length > 50 ? newMessages.slice(-50) : newMessages;
        });
      } catch (error) {
        console.error('Error parsing message:', error);
        // If it's not JSON, store as plain text
        setMessages((prev) => {
          const newMessages = [...prev, { raw: event.data, timestamp: new Date().toISOString() }];
          // Keep only last 50 messages to prevent memory issues
          return newMessages.length > 50 ? newMessages.slice(-50) : newMessages;
        });
      }
    };

    //WS closed or errored
    ws.current.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
    };
    
    ws.current.onerror = (err) => {
      console.error("WebSocket error:", err);
      setIsConnected(false);
    };

    //Cleanup on unmount (removed from UI)
    return () => {
      console.log('Cleaning up WebSocket connection');
      ws.current?.close();
    };
  }, [url]);

  //Function to send message to server
  const sendMessage = (msg) => {
    console.log('Attempting to send message:', msg);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify(msg));
        console.log('Message sent successfully');
        return Promise.resolve(); // Return resolved promise for await support
      } catch (error) {
        console.error('Error sending message:', error);
        return Promise.reject(error);
      }
    } else {
      console.error('WebSocket not connected. Ready state:', ws.current?.readyState);
      return Promise.reject(new Error('WebSocket not connected'));
    }
  };

  // Function to send binary data (ArrayBuffer/TypedArray) to server
  const sendBinary = (data) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        // Support both ArrayBuffer and TypedArray; ensure correct slice for TypedArray views
        let payload;
        if (data instanceof ArrayBuffer) {
          payload = data;
        } else if (ArrayBuffer.isView(data)) {
          const view = data;
          payload = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        } else {
          payload = data;
        }
        ws.current.send(payload);
        return Promise.resolve();
      } catch (error) {
        console.error('Error sending binary data:', error);
        return Promise.reject(error);
      }
    } else {
      return Promise.reject(new Error('WebSocket not connected'));
    }
  };

  // Clear collected messages (UI reset between sessions)
  const clearMessages = () => {
    setMessages([]);
  };

  return { messages, sendMessage, sendBinary, isConnected, clearMessages };
}