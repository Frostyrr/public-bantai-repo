import React from 'react';
import noiseTexture from '../../assets/noise.png';

export const CanvasTexture: React.FC = () => {
  return (
    <div
      className="fixed inset-0 pointer-events-none z-[1] select-none opacity-[0.035] dark:opacity-35"
      style={{
        backgroundImage: `url(${noiseTexture})`,
        backgroundSize: '160px 160px',
        backgroundRepeat: 'repeat',
      }}
      aria-hidden="true"
    />
  );
};

export default CanvasTexture;
