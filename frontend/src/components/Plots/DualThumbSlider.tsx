import React, { useState, useEffect, useRef, useCallback } from "react";
import "./DualThumbSlider.css";

interface DualThumbSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  title?: string;
  step?: number;
  displayMin?: string;
  displayMax?: string;
}

const DualThumbSlider: React.FC<DualThumbSliderProps> = ({
  min,
  max,
  value,
  onChange,
  title,
  step = 1,
  displayMin,
  displayMax,
}) => {
  const [minVal, setMinVal] = useState(value[0]);
  const [maxVal, setMaxVal] = useState(value[1]);
  const minValRef = useRef<HTMLInputElement>(null);
  const maxValRef = useRef<HTMLInputElement>(null);
  const range = useRef<HTMLDivElement>(null);

  // Convert to percentage
  const getPercent = useCallback(
    (value: number) => Math.round(((value - min) / (max - min)) * 100),
    [min, max]
  );

  // Set width of the range to decrease from the left side
  useEffect(() => {
    if (maxValRef.current) {
      const minPercent = getPercent(minVal);
      const maxPercent = getPercent(maxValRef.current.valueAsNumber);

      if (range.current) {
        range.current.style.left = `${minPercent}%`;
        range.current.style.width = `${maxPercent - minPercent}%`;
      }
    }
  }, [minVal, getPercent]);

  // Set width of the range to decrease from the right side
  useEffect(() => {
    if (minValRef.current) {
      const minPercent = getPercent(minValRef.current.valueAsNumber);
      const maxPercent = getPercent(maxVal);

      if (range.current) {
        range.current.style.width = `${maxPercent - minPercent}%`;
      }
    }
  }, [maxVal, getPercent]);

  // Sync external value changes
  useEffect(() => {
    setMinVal(value[0]);
    setMaxVal(value[1]);
  }, [value]);

  return (
    <div className="dual-thumb-slider-container" title={title}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={minVal}
        ref={minValRef}
        onChange={(event) => {
          const value = Math.min(+event.target.value, maxVal - step);
          setMinVal(value);
          onChange([value, maxVal]);
        }}
        className={`dual-thumb-slider-input z-30 ${
          minVal > max - 100 ? "z-50" : ""
        }`}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={maxVal}
        ref={maxValRef}
        onChange={(event) => {
          const value = Math.max(+event.target.value, minVal + step);
          setMaxVal(value);
          onChange([minVal, value]);
        }}
        className="dual-thumb-slider-input z-40"
      />

      {displayMin && (
        <div
          className="absolute text-[10px] font-medium text-gray-700 bg-white/90 border border-gray-200 px-1 py-0.5 rounded shadow-sm whitespace-nowrap z-50 transform -translate-x-1/2 pointer-events-none"
          style={{
            left: `${getPercent(minVal)}%`,
            top: "-1.5rem",
          }}
        >
          {displayMin}
        </div>
      )}

      {displayMax && (
        <div
          className="absolute text-[10px] font-medium text-gray-700 bg-white/90 border border-gray-200 px-1 py-0.5 rounded shadow-sm whitespace-nowrap z-50 transform -translate-x-1/2 pointer-events-none"
          style={{
            left: `${getPercent(maxVal)}%`,
            top: "-1.5rem",
          }}
        >
          {displayMax}
        </div>
      )}

      <div className="dual-thumb-slider-rail">
        <div className="dual-thumb-slider-track" />
        <div
          ref={range}
          className="dual-thumb-slider-range"
        />
      </div>
    </div>
  );
};

export default DualThumbSlider;
