# Quick Start Guide

## What's New

Your timesheet app now has:

1. ✅ **User Accounts** – Login/register system with SQLite database
2. ✅ **Auto-Calculating Hours** – Enter start/finish times, hours calculate automatically
3. ✅ **Overnight Shift Support** – Finish times after midnight work seamlessly
4. ✅ **Auto-Save** – Your work saves automatically to your browser
5. ✅ **Live Validation** – Real-time error checking as you type
6. ✅ **CSV Download** – Export without submitting
7. ✅ **Database Backup** – Submitted timesheets stored on server
8. ✅ **Step 2 Validation** – Submit button moved after review, not before

---

## Installation (5 minutes)

### 1. Install Node.js
Download from https://nodejs.org/ (16+ recommended)

### 2. Install Dependencies
```bash
cd /Users/nathanbrown-bennett/GMT/AutoTimeSheet-GHP
npm install
```

### 3. Start the Server
```bash
npm start
```

You'll see:
```
Server running on http://localhost:3000
```

### 4. Open in Browser
Visit: **http://localhost:3000**

---

## First Time Use

### Step 1: Create Account
1. Click "Need an account? Register"
2. Enter:
   - **Username** (e.g., "john_doe")
   - **Email** (e.g., "john@example.com")
   - **Password** (secure!)
   - **Full Name** (optional, but helpful)
3. Click "Register"

### Step 2: Login
After registering, you're automatically logged in!

---

## Using the App

### Enter Your Timesheet

**1. Set Date Range**
- Enter Start Date and End Date
- Rows auto-generate for each day
- Shows week number automatically

**2. Fill in Times**
For each day:
- **Start Time**: When you started (e.g., 08:30)
- **Finish Time**: When you finished (e.g., 17:00)
  - Can be next day for overnight shifts (e.g., 06:00)
- **Lunch**: How long lunch was (e.g., 30 or 0:30)
- **Notes**: Worksite, task, etc.

**3. Hours Calculate Automatically**
- No need to manually enter Basic/OT hours
- Updates as you type

### Review Your Timesheet (Step 2)

1. Click **"Recalculate Totals & Check Sheet"**
   - Or wait ~0.5 seconds after typing
   
2. See:
   - **Overall Totals** – Total Basic, OT 1.5, OT 2.0
   - **Weekly Totals** – Breakdown by week
   - **Issues** – Any errors to fix

3. Review the Rules:
   - First 40 hours/week = **Basic**
   - Hours 40-50/week = **OT 1.5**
   - Hours 50+/week = **OT 2.0**

### Download or Submit

**Option A: Download CSV** (for your records)
- Click "Download CSV"
- Saves to your computer

**Option B: Submit to Database** (backup on server)
- Click "Submit Timesheet"
- Stored in database under your account
- Email confirmation coming soon!

---

## Tips & Tricks

### Overnight Shifts
Just enter the next day's time naturally:
- Start: 22:00
- Finish: 06:00
- Lunch: 30
- ✅ System handles it automatically!

### Editing
- Change any time field
- Hours update in real-time
- Auto-saves to browser

### Auto-Save
- Data saved to browser storage
- Survives browser closes
- Location: → DevTools → Application → LocalStorage

### Keyboard
- Tab between fields
- Enter to move to next field
- Works on mobile (time picker appears)

---

## Troubleshooting

### "Server not running"
```bash
# Kill old process (if any)
pkill -f "node server.js"

# Start fresh
npm start
```

### Lost your work?
- Check "Application" tab in DevTools
- Look for `timesheet_autosave` in LocalStorage
- Or reload to restore

### Times not calculating?
- Ensure Start and Finish are filled in HH:MM format
- Click "Recalculate Totals & Check Sheet"
- Red highlight shows the error

### Need to register another user?
1. Click Logout (top right)
2. Click "Need an account? Register"
3. Create new account

---

## Data

### What's Stored Locally (Browser)
- Your name
- Dates and times (auto-saved every 1 second)
- Current week

### What's Stored on Server
- User accounts (username, email, hashed password)
- Submitted timesheets (with timestamp)
- Accessible only to that user

---

## Advanced

### Development Mode (Auto-Reload)
```bash
npm run dev
```

Restarts server whenever you change files – great for coding!

### Check Database
```bash
# View all users
sqlite3 timesheet.db "SELECT username, email, created_at FROM users;"

# View all submissions
sqlite3 timesheet.db "SELECT user_id, employee_name, start_date, end_date, submitted_at FROM timesheets;"
```

### Backup Database
```bash
cp timesheet.db timesheet.db.backup
```

---

## Production Deployment

Not ready yet! But when you are, consider:
- **Heroku**: Easy free/paid hosting
- **DigitalOcean**: $5/month VPS
- **AWS/Google Cloud**: More control, higher cost
- **Railway**: Heroku alternative
- **Render**: Another modern option

You'll need:
1. A production database
2. HTTPS enabled
3. Session secret changed
4. Domain name (optional)

---

## Support

**Having issues?**

1. Check browser console (F12 → Console)
2. Check server console (where you ran `npm start`)
3. Verify database file exists: `timesheet.db`
4. Restart server: `npm start` (Ctrl+C then npm start)

---

## Next Steps

1. ✅ Install and run server
2. ✅ Create your account
3. ✅ Enter a day of work
4. ✅ Download CSV to verify
5. ✅ Submit to database
6. ✅ Log out and back in to see it's saved!

Enjoy! 🎉
