import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface SerializedStructure {
  id: string;
  type: string;
  gx: number;
  gy: number;
  gz: number;
  rotation: number;
  health: number;
  maxHealth: number;
  posX?: number;
  posY?: number;
  posZ?: number;
  data?: any;
}

interface WorldSaveData {
  version: number;
  roomId: string;
  worldName: string;
  timestamp: number;
  dayCount: number;
  dayTime: number;
  sharkDefeatedOnce: boolean;
  structures: SerializedStructure[];
}

interface ConnectedPlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  isSwimming: boolean;
  lastUpdated: number;
}

interface RoomState {
  id: string;
  clients: Map<string, { ws: WebSocket; player: ConnectedPlayer }>;
  world: WorldSaveData;
  saveDebounce?: any;
}

const SAVES_DIR = path.resolve(__dirname, 'saves');
if (!fs.existsSync(SAVES_DIR)) {
  fs.mkdirSync(SAVES_DIR, { recursive: true });
}

function getInitialWorld(roomId: string): WorldSaveData {
  return {
    version: 1,
    roomId,
    worldName: 'Oceanic Raft',
    timestamp: Date.now(),
    dayCount: 1,
    dayTime: 0.25,
    sharkDefeatedOnce: false,
    structures: [
      // Default 2x2 starting raft foundations
      { id: 'foundation_0_0', type: 'foundation', gx: 0, gy: 0, gz: 0, rotation: 0, health: 100, maxHealth: 100, posX: 0, posY: 0, posZ: 0 },
      { id: 'foundation_1_0', type: 'foundation', gx: 1, gy: 0, gz: 0, rotation: 0, health: 100, maxHealth: 100, posX: 2, posY: 0, posZ: 0 },
      { id: 'foundation_0_1', type: 'foundation', gx: 0, gy: 0, gz: 1, rotation: 0, health: 100, maxHealth: 100, posX: 0, posY: 0, posZ: 2 },
      { id: 'foundation_1_1', type: 'foundation', gx: 1, gy: 0, gz: 1, rotation: 0, health: 100, maxHealth: 100, posX: 2, posY: 0, posZ: 2 },
    ],
  };
}

function loadRoomSave(roomId: string): WorldSaveData {
  const file = path.join(SAVES_DIR, `world_${roomId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (data && Array.isArray(data.structures)) {
        return data;
      }
    } catch (err) {
      console.error(`Failed to load world save for room ${roomId}:`, err);
    }
  }
  return getInitialWorld(roomId);
}

function saveRoomSave(room: RoomState) {
  const file = path.join(SAVES_DIR, `world_${room.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  try {
    room.world.timestamp = Date.now();
    fs.writeFileSync(file, JSON.stringify(room.world, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Failed to write world save for room ${room.id}:`, err);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const rooms = new Map<string, RoomState>();

  function getOrCreateRoom(roomId: string): RoomState {
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        id: roomId,
        clients: new Map(),
        world: loadRoomSave(roomId),
      };
      rooms.set(roomId, room);
    }
    return room;
  }

  // REST API Routes
  app.get('/api/world/:roomId', (req, res) => {
    const roomId = req.params.roomId || 'ocean-world-1';
    const room = getOrCreateRoom(roomId);
    res.json(room.world);
  });

  app.post('/api/world/:roomId', (req, res) => {
    const roomId = req.params.roomId || 'ocean-world-1';
    const room = getOrCreateRoom(roomId);
    if (req.body && Array.isArray(req.body.structures)) {
      room.world = {
        ...room.world,
        ...req.body,
        roomId,
      };
      saveRoomSave(room);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid world payload' });
    }
  });

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    try {
      const host = request.headers.host || 'localhost';
      const url = new URL(request.url || '', `http://${host}`);
      if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore non-standard URL upgrades
    }
  });

  // WebSocket Connection Handler
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const roomId = url.searchParams.get('room') || 'ocean-world-1';
    const playerId = url.searchParams.get('id') || `p_${Date.now()}`;
    const playerName = url.searchParams.get('name') || 'Survivor';
    const playerColor = url.searchParams.get('color') || '#38bdf8';

    const room = getOrCreateRoom(roomId);

    const player: ConnectedPlayer = {
      id: playerId,
      name: playerName,
      color: playerColor,
      x: 0,
      y: 1.85,
      z: 0,
      yaw: 0,
      pitch: 0,
      health: 100,
      maxHealth: 100,
      isSwimming: false,
      lastUpdated: Date.now(),
    };

    room.clients.set(playerId, { ws, player });

    // Send init state to connected client
    const allPlayersInRoom = Array.from(room.clients.values()).map((c) => c.player);
    ws.send(
      JSON.stringify({
        type: 'init',
        player,
        world: room.world,
        players: allPlayersInRoom,
      })
    );

    // Notify other clients in room
    room.clients.forEach(({ ws: clientWs }, otherId) => {
      if (otherId !== playerId && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'player:joined',
            player,
          })
        );
      }
    });

    // Handle incoming client messages
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'player:move': {
            player.x = msg.x ?? player.x;
            player.y = msg.y ?? player.y;
            player.z = msg.z ?? player.z;
            player.yaw = msg.yaw ?? player.yaw;
            player.pitch = msg.pitch ?? player.pitch;
            player.health = msg.health ?? player.health;
            player.maxHealth = msg.maxHealth ?? player.maxHealth;
            player.isSwimming = !!msg.isSwimming;
            player.lastUpdated = Date.now();

            // Broadcast movement to all other clients in the room
            const payload = JSON.stringify({
              type: 'player:moved',
              id: playerId,
              name: player.name,
              color: player.color,
              x: player.x,
              y: player.y,
              z: player.z,
              yaw: player.yaw,
              pitch: player.pitch,
              health: player.health,
              maxHealth: player.maxHealth,
              isSwimming: player.isSwimming,
            });

            room.clients.forEach(({ ws: clientWs }, otherId) => {
              if (otherId !== playerId && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(payload);
              }
            });
            break;
          }

          case 'structure:place': {
            if (msg.structure) {
              const struct = msg.structure as SerializedStructure;
              // Add or update structure in room world
              const existingIdx = room.world.structures.findIndex((s) => s.id === struct.id);
              if (existingIdx >= 0) {
                room.world.structures[existingIdx] = struct;
              } else {
                room.world.structures.push(struct);
              }

              // Debounced save
              if (room.saveDebounce) clearTimeout(room.saveDebounce);
              room.saveDebounce = setTimeout(() => saveRoomSave(room), 1000);

              // Broadcast to other players in room
              const payload = JSON.stringify({
                type: 'structure:placed',
                structure: struct,
                playerName: player.name,
              });

              room.clients.forEach(({ ws: clientWs }, otherId) => {
                if (otherId !== playerId && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(payload);
                }
              });
            }
            break;
          }

          case 'structure:demolish': {
            if (msg.id) {
              room.world.structures = room.world.structures.filter((s) => s.id !== msg.id);

              if (room.saveDebounce) clearTimeout(room.saveDebounce);
              room.saveDebounce = setTimeout(() => saveRoomSave(room), 1000);

              const payload = JSON.stringify({
                type: 'structure:demolished',
                id: msg.id,
              });

              room.clients.forEach(({ ws: clientWs }, otherId) => {
                if (otherId !== playerId && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(payload);
                }
              });
            }
            break;
          }

          case 'structure:update': {
            if (msg.id && msg.data) {
              const struct = room.world.structures.find((s) => s.id === msg.id);
              if (struct) {
                struct.data = { ...struct.data, ...msg.data };
              }

              const payload = JSON.stringify({
                type: 'structure:updated',
                id: msg.id,
                data: msg.data,
              });

              room.clients.forEach(({ ws: clientWs }, otherId) => {
                if (otherId !== playerId && clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(payload);
                }
              });
            }
            break;
          }

          case 'shark:defeat': {
            room.world.sharkDefeatedOnce = true;
            saveRoomSave(room);

            const payload = JSON.stringify({
              type: 'shark:defeated',
            });

            room.clients.forEach(({ ws: clientWs }, otherId) => {
              if (otherId !== playerId && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(payload);
              }
            });
            break;
          }
        }
      } catch (e) {
        console.error('Error handling WS message:', e);
      }
    });

    ws.on('close', () => {
      room.clients.delete(playerId);
      // Notify remaining players
      const payload = JSON.stringify({
        type: 'player:left',
        id: playerId,
      });

      room.clients.forEach(({ ws: clientWs }) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(payload);
        }
      });
    });
  });

  // Setup Vite in development or static serve in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = process.env.PORT || 3000;
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Raft 3D Server running on http://localhost:${PORT}`);
  });
}

startServer();
