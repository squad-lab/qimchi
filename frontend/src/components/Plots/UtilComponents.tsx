/* eslint-disable react-refresh/only-export-components -- plot helpers intentionally share this component module */
import { ChartLine, Grid, Check } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import {
  extractQanaryMeasurementId,
  formatQanaryMeasurementId,
} from "../../utils/measurementDisplay";

// Type for option with icon
type OptionWithIconType = {
  label: string;
  value: string;
  icon?: React.ComponentType<{ size?: number; className?: string }> | string;
};

// Helper function to format title: shows UUID for qanary datasets, truncated title otherwise
const formatTitleWithUUID = (title: string, maxLength = 15) => {
  if (!title) return "Plot";

  const uuid = extractUUID(title);

  if (uuid) {
    const displayId = formatQanaryMeasurementId(uuid);
    if (displayId.length <= maxLength) {
      return displayId;
    }
    return `${displayId.substring(0, maxLength - 3)}...`;
  }

  // No UUID (non-qanary dataset): show the title itself, truncated
  if (title.length <= maxLength) {
    return title;
  }
  return `${title.substring(0, maxLength - 3)}...`;
};

// Helper function to get plot type icon
const getPlotTypeIcon = (plotType: string) => {
  switch (plotType) {
    case "heatmap":
      return <Grid size={18} className="text-purple-600" />;
    case "line":
      return <ChartLine size={18} className="text-blue-600" />;
    default:
      return <ChartLine size={18} className="text-gray-600" />;
  }
};

// Helper function to extract UUID from plot title
const extractUUID = (title: string): string | null => {
  return extractQanaryMeasurementId(title);
};

// Custom icon for log axis
const LogChartIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 12,
  className,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {/* Axes */}
    <path d="M3 3v18h18" />
    {/* Logarithmic curve starting at '1' on x-axis */}
    <path d="M6 18 C10 8, 15 6, 21 3" />
  </svg>
);

// Custom ApplyButton component
interface ApplyButtonProps {
  isEnabled: boolean;
  onToggle: () => void;
  label?: string;
  className?: string;
}

const ApplyButton: React.FC<ApplyButtonProps> = ({
  isEnabled,
  onToggle,
  label = "Apply",
  className = "",
}) => {
  return (
    <button
      onClick={onToggle}
      className={`
        relative inline-flex items-center justify-between w-full px-2.5 py-2 rounded-md
        text-sm font-medium transition-all duration-200 cursor-pointer
        border focus:outline-none focus:ring-2 focus:ring-offset-1
        ${
          isEnabled
            ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700 focus:ring-blue-500 shadow-sm"
            : "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200 hover:text-gray-700 focus:ring-gray-400"
        }
        ${className}
      `}
      aria-label={`${isEnabled ? "Disable" : "Enable"} filter`}
      title={`${isEnabled ? "Disable" : "Enable"} filter`}
    >
      <span>{label}</span>
      <div
        className={`
          w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-200
          ${isEnabled ? "bg-white border-white" : "bg-transparent border-gray-400"}
        `}
      >
        {isEnabled && <Check size={12} className="text-blue-600" strokeWidth={3} />}
      </div>
    </button>
  );
};

// Helper component for custom dropdown with icons
const IconDropdown: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: OptionWithIconType[];
  className?: string;
  title?: string;
  "aria-label"?: string;
}> = ({ value, onChange, options, className, title, "aria-label": ariaLabel }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const renderOption = (option: OptionWithIconType, isSelected = false) => {
    const IconComponent = option.icon;

    return (
      <div className={`flex items-center gap-2 ${isSelected ? "font-medium" : ""}`}>
        {typeof option.icon === "string" ? (
          <span className="text-xs font-mono text-gray-500 min-w-[60px] text-center">
            {option.icon}
          </span>
        ) : IconComponent ? (
          <IconComponent size={14} className="text-gray-500 min-w-[14px]" />
        ) : (
          <div className="min-w-[14px]" />
        )}
        <span className="text-sm">{option.label}</span>
      </div>
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${className} flex items-center justify-between`}
        title={title}
        aria-label={ariaLabel}
        {...(isOpen ? { "aria-expanded": "true" } : { "aria-expanded": "false" })}
        aria-haspopup="listbox"
      >
        {selectedOption ? renderOption(selectedOption, true) : value}
        <svg
          className="w-4 h-4 ml-2 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 text-left hover:bg-gray-100 ${
                option.value === value ? "bg-blue-50 text-blue-700" : "text-gray-900"
              }`}
            >
              {renderOption(option, option.value === value)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export {
  getPlotTypeIcon,
  extractUUID,
  formatTitleWithUUID,
  LogChartIcon,
  ApplyButton,
  IconDropdown,
};
