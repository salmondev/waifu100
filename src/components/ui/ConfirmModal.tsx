import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export function ConfirmModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = "Confirm", 
  cancelText = "Cancel",
  variant = 'danger'
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
        
        <div className={cn("absolute top-0 left-0 right-0 h-1", 
            variant === 'danger' ? "bg-red-500" : 
            variant === 'warning' ? "bg-yellow-500" : "bg-blue-500"
        )} />

        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors p-1 rounded-full hover:bg-zinc-800"
        >
          <X size={20} />
        </button>

        <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
                <div className={cn("p-3 rounded-full",
                    variant === 'danger' ? "bg-red-900/20 text-red-500" :
                    variant === 'warning' ? "bg-yellow-900/20 text-yellow-500" : "bg-blue-900/20 text-blue-500"
                )}>
                    <AlertTriangle size={24} />
                </div>
                <h3 className="text-xl font-bold text-white">{title}</h3>
            </div>
            
            <p className="text-zinc-400 mb-8 leading-relaxed">
                {message}
            </p>

            <div className="flex justify-end gap-3">
                <button 
                    onClick={onClose}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
                >
                    {cancelText}
                </button>
                <button 
                    onClick={() => {
                        onConfirm();
                        onClose();
                    }}
                    className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                        variant === 'danger' ? "bg-red-600 hover:bg-red-500 text-white" :
                        variant === 'warning' ? "bg-yellow-600 hover:bg-yellow-500 text-black" : "bg-blue-600 hover:bg-blue-500 text-white"
                    )}
                >
                    {confirmText}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
}
