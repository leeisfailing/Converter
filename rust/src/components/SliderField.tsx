interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}

export default function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  suffix,
}: Props) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-app-text-secondary min-w-[80px]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="flex-1"
      />
      <span className="text-[10px] text-app-text-muted min-w-[40px] text-right">
        {value.toFixed(step < 1 ? 1 : 0)}{suffix ?? ""}
      </span>
    </div>
  );
}
