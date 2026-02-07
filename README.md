# GMT Timesheet Checker & Builder

Full-stack web application for GMT weekly timesheets with authentication, automatic hour calculation, and validation.

## Features

- **User Authentication**: Secure login/registration with session management and SQLite database
- **Automatic Hour Calculation**: Hours (Basic, OT 1.5, OT 2.0) automatically calculated from Start, Finish, and Lunch times
- **Overnight Shift Support**: Handles shifts that cross midnight
- **Live Validation**: Real-time calculation and error checking as you type
- **Auto-Save**: Data automatically saved to browser localStorage
- **Multi-Week Support**: Navigate between multiple weeks with Previous/Next buttons
- **Upload Word Documents**: Import GMT weekly timesheet `.docx` files using Mammoth.js
- **CSV Export**: Download your timesheet as CSV without submitting
- **Database Storage**: Submitted timesheets stored in SQLite database
- **100% Privacy**: All calculations happen locally; only submitted timesheets are stored on server

## Project Structure

- `server.js` — Node.js/Express backend with SQLite database and authentication
- `package.json` — Node.js dependencies and scripts
- `index.html` — UI markup with login modal and responsive design
- `styles.css` — Modern dark UI styling with modal and auth components
- `script.js` — Core logic: auth, parsing, auto-calculation, validation, CSV export
- `timesheet.db` — SQLite database (auto-created on first run)

## Installation & Setup

### Prerequisites

- Node.js 16+ and npm

### Install Dependencies

```bash
npm install
```

### Run the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:3000`

## Usage

### 1. Login/Register

- On first visit, you'll see a login modal
- Click "Need an account? Register" to create a new account
- Provide username, email, password, and full name
- After registration/login, you'll be redirected to the timesheet builder

### 2. Build Your Timesheet

**Manual Entry:**
- Enter your name (auto-filled from registration if provided)
- Select start and end date range (auto-generates daily rows)
- For each day, enter:
  - **Start time** (HH:MM, 24-hour format)
  - **Finish time** (HH:MM, can be next day for overnight shifts)
  - **Lunch break** (minutes or HH:MM)
  - **Notes** (worksite, etc.)

**Upload .docx:**
- Switch to "Upload" mode
- Select a GMT weekly timesheet Word file
- The app will parse and populate the table automatically

### 3. Review & Validate

- Click "Recalculate Totals & Check Sheet" (or wait for auto-recalc)
- Review:
  - **Overall Totals**: Total Basic, OT 1.5, OT 2.0 hours
  - **Weekly Totals**: Breakdown by week
  - **Issues**: Any validation errors (highlighted in red)

**Automatic Overtime Rules:**
- First 40 hours/week = Basic hours
- Hours 40-50/week = OT 1.5
- Hours 50+/week = OT 2.0

### 4. Submit or Download

- **Download CSV**: Save timesheet as CSV file for your records
- **Submit Timesheet**: Save to database (only available after login)
- After successful submission, auto-save is cleared

## Technical Details

### Backend (Node.js + Express + SQLite)

- **Authentication**: bcrypt password hashing, express-session for sessions
- **Database**: SQLite with `users` and `timesheets` tables
- **API Endpoints**:
  - `POST /api/register` — Create new user
  - `POST /api/login` — Authenticate user
  - `POST /api/logout` — End session
  - `GET /api/auth/status` — Check current auth status
  - `POST /api/timesheets/submit` — Submit timesheet (requires auth)
  - `GET /api/timesheets` — Get user's timesheets
  - `GET /api/timesheets/:id` — Get specific timesheet

### Frontend Features

- **Auto-save**: Saves to localStorage every 1 second after input stops
- **Live Recalculation**: Debounced 500ms after time/lunch input changes
- **Overnight Shifts**: If finish < start, adds 24 hours automatically
- **Week Navigation**: Organizes rows by week number, shows one week at a time
- **Error Highlighting**: Red background on cells with validation errors

### Supported .docx Format

Standard GMT weekly timesheet with headers containing:
- DATE
- WORKSITE ADDRESS (or SITE)
- START
- FINISH
- LUNCH (or BREAK)

Basic/OT columns are optional (hours will be auto-calculated).

## Deployment

### Local/Development

```bash
npm start
```

### Production

1. Set `NODE_ENV=production`
2. Change session secret in `server.js` to a strong random string
3. Enable HTTPS and set `cookie.secure: true` in session config
4. Consider using PM2 or similar for process management:

```bash
npm install -g pm2
pm2 start server.js --name timesheet-app
```

### GitHub Pages (Frontend Only)

**Note**: GitHub Pages won't support the backend features (auth, database). For full functionality, deploy both frontend and backend to a platform like:
- Heroku
- DigitalOcean
- AWS/Google Cloud
- Railway
- Render

## Security Notes

- Passwords are hashed with bcrypt (10 rounds)
- Sessions use HTTP-only cookies
- Change the session secret before production deployment
- Use HTTPS in production
- Database is gitignored by default

## Browser Compatibility

Requires modern browser with:
- ES6+ JavaScript
- Fetch API
- LocalStorage
- CSS Grid/Flexbox

Tested on Chrome, Firefox, Safari, Edge.

## License

ISC

## Contributing

Issues and pull requests welcome!
