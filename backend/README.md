# WhatsApp-GHL Backend

Node.js backend for WhatsApp to GoHighLevel integration using Baileys (WhatsApp Web API).

## Features

- **Multiple WhatsApp Sessions**: Support for managing multiple WhatsApp accounts simultaneously
- **Real-time QR Code Scanning**: WebSocket-based QR code delivery for instant connection
- **WhatsApp Groups Management**: Create groups, add participants, and manage permissions
- **Message Synchronization**: Sync messages to GoHighLevel CRM
- **WebSocket Support**: Real-time updates via Socket.io

## Tech Stack

- **Node.js** with ES Modules
- **Express.js** - Web framework
- **@whiskeysockets/baileys** - WhatsApp Web API
- **Socket.io** - WebSocket communication
- **PostgreSQL** - Database (via Railway)
- **Pino** - Logging

## Getting Started

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database (Railway will provide this in production)

### Installation

1. Clone the repository
2. Navigate to the backend directory:
   ```bash
   cd backend
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

5. Update the `.env` file with your configuration

### Development

Run the development server with hot reload:

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### Production

Start the production server:

```bash
npm start
```

## API Endpoints

### Health Check
- `GET /api/health` - Check server status

### Sessions
- `POST /api/sessions/create` - Create a new WhatsApp session
- `GET /api/sessions` - List all sessions
- `GET /api/sessions/:session_id/status` - Get session status
- `POST /api/sessions/:session_id/disconnect` - Disconnect a session

### Groups
- `GET /api/groups/:session_id/groups` - Get all groups for a session
- `POST /api/groups/:session_id/create` - Create a new group
- `POST /api/groups/:group_jid/add-participants` - Add participants to a group
- `POST /api/groups/:group_jid/promote` - Promote participants to admin

### Messages
- `POST /api/messages/:session_id/send` - Send a message

## WebSocket Events

### Client to Server
- `join_session` - Join a session room to receive updates

### Server to Client
- `qr_updated` - QR code updated (for scanning)
- `connection_status` - Connection status changed
- `new_message` - New message received

## Deployment

This backend is designed to deploy on Railway.app with PostgreSQL.

### Railway Setup

1. Create a new project on Railway
2. Add a PostgreSQL database
3. Connect your GitHub repository
4. Railway will automatically detect the `Procfile` and deploy

### Environment Variables on Railway

Set these environment variables in your Railway project:

- `DATABASE_URL` - Automatically provided by Railway PostgreSQL
- `FRONTEND_URL` - Your frontend URL
- `NODE_ENV` - Set to `production`
- `LOG_LEVEL` - Set to `info`

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── database.js          # PostgreSQL connection
│   ├── whatsapp/
│   │   ├── SessionManager.js    # Core session management
│   │   └── QRGenerator.js       # QR code generation
│   ├── api/
│   │   └── routes/
│   │       ├── sessions.js      # WhatsApp session routes
│   │       ├── groups.js        # Group management routes
│   │       ├── messages.js      # Send message routes
│   │       └── health.js        # Health check endpoint
│   ├── services/
│   │   └── ghlService.js        # GoHighLevel API integration
│   └── server.js                # Main entry point
├── auth_sessions/               # Baileys session storage (gitignored)
├── .env.example
├── .gitignore
├── package.json
├── Procfile                     # Railway deployment
└── README.md
```

## Testing

### Test Health Endpoint

```bash
curl http://localhost:3000/api/health
```

### Create a Session

```bash
curl -X POST http://localhost:3000/api/sessions/create \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "test_session_1",
    "user_id": "user123",
    "sub_account_id": "sub123"
  }'
```

### Connect via WebSocket

Use a Socket.io client to connect and listen for QR codes:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.emit('join_session', 'test_session_1');

socket.on('qr_updated', (data) => {
  console.log('QR Code:', data.qr);
  // Display QR code to user
});

socket.on('connection_status', (data) => {
  console.log('Status:', data.status);
});
```

## Success Criteria

After deployment, verify:

1. ✅ Server starts without errors
2. ✅ Health endpoint responds
3. ✅ Can create WhatsApp session
4. ✅ QR code emits via Socket.io
5. ✅ Session connects successfully after scanning
6. ✅ Can fetch groups
7. ✅ Can create new groups
8. ✅ Can send messages

## Next Steps

- [ ] Deploy to Railway
- [ ] Connect frontend (Lovable)
- [ ] Implement full GHL sync
- [ ] Add database persistence for messages
- [ ] Add authentication middleware
- [ ] Implement rate limiting
- [ ] Add comprehensive error handling
- [ ] Set up monitoring and alerts

## License

MIT
