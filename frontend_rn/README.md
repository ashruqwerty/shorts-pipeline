# React Native Frontend (Expo)

This app is the React Native frontend for Shorts Creator Console.

## Targets
- Android phone
- Tablet
- Laptop browser (React Native Web)

## Backend requirement
Your FastAPI backend should be running at:
- http://127.0.0.1:8000

If testing on a physical phone, set your laptop LAN IP:
- EXPO_PUBLIC_API_BASE_URL=http://<YOUR_LAN_IP>:8000

## Run
1. Install dependencies
   npm install

2. Start Expo
   npm run start

3. Open platform
- Android: npm run android
- Web: npm run web

## Current screens
- Today (default landing)
- Tasks
- Assets
- Teleprompter modal

## Notes
- Upload kinds are intentionally restricted to a_roll and b_roll_custom.
- AI script generation and Veo integration are deferred to next phase.
