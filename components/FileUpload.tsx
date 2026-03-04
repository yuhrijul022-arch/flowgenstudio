
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Icon } from './Icon';

interface FileUploadProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  title?: string;
  note?: string;
  id: string;
  disabled?: boolean;
  compact?: boolean;
  maxFiles?: number;
  className?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ 
    files, 
    onFilesChange, 
    title, 
    note, 
    id, 
    disabled = false, 
    compact = false,
    maxFiles = 1,
    className = ''
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  // Manage previews
  useEffect(() => {
    const newPreviews = files.map(file => URL.createObjectURL(file));
    setPreviews(newPreviews);
    
    // Cleanup
    return () => {
        newPreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [files]);

  const handleFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    
    const validFiles = Array.from(newFiles).filter(file => file.type.startsWith('image/'));
    
    if (validFiles.length === 0) return;

    if (maxFiles === 1) {
        onFilesChange([validFiles[0]]);
    } else {
        const remainingSlots = maxFiles - files.length;
        const filesToAdd = validFiles.slice(0, remainingSlots);
        if (filesToAdd.length > 0) {
            onFilesChange([...files, ...filesToAdd]);
        }
    }
  }, [files, maxFiles, onFilesChange]);

  const removeFile = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newFiles = [...files];
    newFiles.splice(index, 1);
    onFilesChange(newFiles);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!disabled) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleClick = () => {
    if (!disabled && files.length < maxFiles) fileInputRef.current?.click();
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files);
    e.target.value = ''; // Reset input to allow re-uploading the same file
  };

  const isSingleMode = maxFiles === 1;
  const hasFiles = files.length > 0;

  // Apple-style minimalist styling
  const containerClasses = `relative flex flex-col w-full rounded-2xl transition-all duration-300 overflow-hidden ${compact ? 'h-40' : 'min-h-[14rem]'}`;
  
  // Clean, dark surface colors
  const stateClasses = disabled
    ? "bg-[#1c1c1e] cursor-not-allowed opacity-50"
    : isDragging
    ? "bg-[#2c2c2e] ring-2 ring-[#0071e3]"
    : "bg-[#1c1c1e] hover:bg-[#2c2c2e] cursor-pointer";

  return (
    <div className="w-full h-full flex flex-col">
        {title && <h3 className="text-sm font-semibold text-gray-200 mb-3 tracking-tight">{title}</h3>}
        
        <input
            type="file"
            id={id}
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileChange}
            disabled={disabled}
            multiple={maxFiles > 1}
        />

        {/* Case 1: Single File Mode with File (Display Large Preview) */}
        {isSingleMode && hasFiles ? (
             <div 
                className={`${containerClasses} ${stateClasses} p-0 ${className}`}
                onClick={handleClick}
             >
                 <div className="relative w-full h-full group cursor-pointer">
                    <img src={previews[0]} alt="Preview" className="object-cover w-full h-full opacity-90 hover:opacity-100 transition-opacity" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); onFilesChange([]); }} className="bg-[#1c1c1e] text-white rounded-full p-2.5 shadow-xl backdrop-blur-md border border-white/10 hover:scale-105 transition-transform">
                           <Icon icon="trash" className="w-5 h-5" />
                        </button>
                    </div>
                </div>
             </div>
        ) : (
             /* Case 2: Multi File Mode with Files OR Empty */
             <div
                className={`${containerClasses} ${stateClasses} ${!hasFiles ? 'items-center justify-center' : 'p-4'} ${className}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={!hasFiles ? handleClick : undefined}
             >
                {!hasFiles ? (
                    <div className="flex flex-col items-center justify-center text-center p-4">
                        <div className="bg-[#2c2c2e] rounded-full p-3 mb-3 text-gray-400">
                            <Icon icon="upload" className="w-5 h-5"/>
                        </div>
                        <p className="font-medium text-gray-300 text-sm">
                           {maxFiles > 1 ? "Upload Images" : "Upload Image"}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">Drag and drop or click</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2 w-full h-full content-start">
                        {previews.map((url, idx) => (
                            <div key={idx} className="relative aspect-square rounded-lg overflow-hidden group bg-black/50 border border-white/5">
                                <img src={url} alt={`Upload ${idx}`} className="w-full h-full object-cover" />
                                <button 
                                    onClick={(e) => removeFile(idx, e)}
                                    className="absolute top-1 right-1 bg-black/60 hover:bg-red-500/80 text-white rounded-full p-1 backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Icon icon="x" className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                        {files.length < maxFiles && (
                             <button 
                                onClick={(e) => { e.stopPropagation(); handleClick(); }}
                                className="aspect-square rounded-lg border border-dashed border-gray-600 hover:border-gray-400 hover:bg-[#2c2c2e] flex flex-col items-center justify-center text-gray-500 transition-all"
                             >
                                <Icon icon="plus" className="w-5 h-5" />
                             </button>
                        )}
                    </div>
                )}
             </div>
        )}
        
        {note && <p className="text-[11px] text-center text-gray-500 mt-2 font-medium">{note}</p>}
    </div>
  );
};
