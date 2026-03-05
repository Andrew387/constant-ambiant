/**
 * Lightweight HTTP + WebSocket server for the debug / control UI.
 *
 * - Serves the static index.html page on GET /
 * - Accepts WebSocket connections for bidirectional control messages
 * - Broadcasts engine state (chord, section, tempo, archive, etc.)
 *   to all connected clients
 *
 * All control messages are JSON: { type: string, ...payload }
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

let wss = null;
let httpServer = null;
let messageHandler = null; // set by startServer caller

/**
 * Starts the HTTP + WS server.
 *
 * @param {object} opts
 * @param {number} opts.port - HTTP port (default 3000)
 * @param {Function} opts.onMessage - Called with (ws, parsedJSON) for each WS message
 * @returns {Promise<void>}
 */
export function startServer({ port = 3000, onMessage } = {}) {
  messageHandler = onMessage || null;

  return new Promise((resolve, reject) => {
    httpServer = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(INDEX_PATH, 'utf-8', (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end('Error loading UI');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      console.log('[server] Client connected');

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (messageHandler) messageHandler(ws, msg);
        } catch (err) {
          console.warn('[server] Bad WS message:', err.message);
        }
      });

      ws.on('close', () => {
        console.log('[server] Client disconnected');
      });
    });

    httpServer.listen(port, () => {
      console.log(`[server] UI available at http://localhost:${port}`);
      resolve();
    });

    httpServer.on('error', reject);
  });
}

/**
 * Broadcasts a JSON message to all connected WebSocket clients.
 * @param {object} data - Will be JSON.stringify'd
 */
export function broadcast(data) {
  if (!wss) return;
  const payload = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(payload);
    }
  }
}

/**
 * Sends a JSON message to a specific client.
 */
export function sendTo(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Shuts down the server.
 */
export function stopServer() {
  if (wss) {
    for (const client of wss.clients) client.close();
    wss.close();
    wss = null;
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}
