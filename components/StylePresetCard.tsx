
import React from 'react';
import { StylePreset } from '../types';

interface StylePresetCardProps {
  preset: StylePreset;
  isSelected: boolean;
  onSelect: (id: string) => void;
  disabled: boolean;
}

export const StylePresetCard: React.FC<StylePresetCardProps> = ({ preset, isSelected, onSelect, disabled }) => {
    // Apple-style minimalist selector
    const baseClasses = "relative px-4 py-3 rounded-xl font-medium text-sm text-center transition-all duration-200 flex items-center justify-center h-14 md:h-16 border";
    
    // Using Apple Blue #0071e3 for active state
    const stateClasses = isSelected
    ? "border-[#0071e3] bg-[#0071e3] text-white shadow-lg shadow-[#0071e3]/20"
    : disabled
    ? "bg-[#1c1c1e] border-transparent text-gray-600 cursor-not-allowed"
    : "bg-[#1c1c1e] border-transparent text-gray-300 hover:bg-[#2c2c2e] cursor-pointer";

  return (
    <div 
        className={`${baseClasses} ${stateClasses}`} 
        onClick={() => !disabled && onSelect(preset.id)}
        title={preset.description} 
    >
      <span className="truncate px-1">{preset.name}</span>
    </div>
  );
};
