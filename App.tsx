import React, { useState } from 'react';
import { Visualizer } from './components/Visualizer';

const App: React.FC = () => {
  const [active, setActive] = useState(false);

  if (!active) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
        {/* Abstract Background Elements */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-700"></div>

        <div className="max-w-lg w-full bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-2xl p-8 shadow-2xl z-10">
          <div className="mb-8 text-center">
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 mb-2">
              LuminaFlow
            </h1>
            <p className="text-zinc-400">Interactive Computer Vision Experience</p>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-4 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
              <div className="bg-zinc-700 p-2 rounded text-xl">🖐️</div>
              <div>
                <h3 className="font-semibold text-zinc-200">Hand Tracking</h3>
                <p className="text-sm text-zinc-400">Uses MediaPipe AI to track your hand movements in real-time.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
              <div className="bg-zinc-700 p-2 rounded text-xl">🔦</div>
              <div>
                <h3 className="font-semibold text-zinc-200">Light Reactive</h3>
                <p className="text-sm text-zinc-400">Shine a flashlight at the camera to intensify the particle effects.</p>
              </div>
            </div>

            <button
              onClick={() => setActive(true)}
              className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-cyan-900/20"
            >
              Start Experience
            </button>
            
            <p className="text-xs text-center text-zinc-600">
              Requires camera access. Processing happens locally on your device.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <Visualizer onClose={() => setActive(false)} />;
};

export default App;