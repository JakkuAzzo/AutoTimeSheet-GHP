# Staff Portal Walkthrough Video

The employee walkthrough is generated locally, not committed as a Git binary:

```text
outputs/staff-walkthrough/gmt-staff-portal-walkthrough.mp4
```

It covers:

1. Signing in with an existing GMT Microsoft 365 account.
2. Quick clock, lunch, absence and full-day records.
3. Weekly timesheet creation and daily cards.
4. Job cards.
5. Task requests.
6. Calendar requests.
7. Timesheet audit uploads.

The recording uses only `Demo Employee` values and never clicks a real submit
button. It is safe to circulate internally as a training video.

## Regenerate

```bash
node tools/record-staff-walkthrough.mjs all
ffmpeg -y -i outputs/staff-walkthrough/gmt-staff-portal-walkthrough-part-1.mp4 \
  -c copy outputs/staff-walkthrough/gmt-staff-portal-walkthrough.mp4
```

The script records the current local files with Entra authentication disabled
only inside its temporary local server. Production users still sign in through
Microsoft Entra.
