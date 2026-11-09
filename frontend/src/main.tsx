import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './workspace.css';
import './theme.css';
import { rosService } from './services/rosService';
import { topicBus } from './sim/topicBus';
import { cameraFeed } from './sim/wristCamera';
import * as vision from './sim/vision';
import * as visionTrain from './sim/visionTrain';

// Inspection hook for debugging and automated tests: open the app with ?debug
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as Record<string, unknown>).__nora = { rosService, topicBus, cameraFeed, vision, visionTrain };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

