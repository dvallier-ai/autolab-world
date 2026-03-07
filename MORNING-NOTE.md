# Morning Test Instructions

## Current State
Server is running with debug logging + regex fallback for empty payloads.

## How to Test
1. Open http://localhost:3333
2. Click on Nova agent
3. Press M (or click "Send Message")
4. Type a test message: "hello"
5. Check if reply appears

## Expected Behavior
- Should show my actual reply now (with regex fallback)
- Check browser console (F12) for [message-panel] logs
- Check server logs: `tail -f /tmp/openclaw-viz.log | grep "^\[api\]"`

## If Still Broken
The issue is that `openclaw agent --session-id channel:telegram:nova --message "X" --json`
returns empty `payloads[]` array when called from Node.js exec, even though it works
fine from terminal.

### Possible Solutions to Try
1. Use `--deliver` flag (might change output structure)
2. Send to a different session (not the active Telegram one)
3. Check PATH/environment variables in exec
4. Add longer timeout / wait for completion
5. Just show the raw stdout (skip JSON parsing entirely)
6. Find the correct gateway WebSocket RPC method (not "session-send")

## Commits Last Night
- `618a704` - Parse reply from CLI JSON
- `9abc576` - Extract last line with logging
- `e0e578b` - Add regex fallback for empty payloads

## Files Modified
- `server.js` - Line ~615 (message endpoint with extensive logging)
- `app.js` - Display reply immediately from API response
- `memory/2026-02-11.md` - Full debug notes

Good luck! 🪄
