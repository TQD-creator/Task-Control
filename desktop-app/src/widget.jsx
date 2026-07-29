import React from 'react';
import ReactDOM from 'react-dom/client';
import TimerWidget from './widget/TimerWidget.jsx';
import './widget/widget.css';

ReactDOM.createRoot(document.getElementById('widget-root')).render(
  <React.StrictMode>
    <TimerWidget />
  </React.StrictMode>
);
