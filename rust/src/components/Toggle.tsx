interface Props {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export default function Toggle({ label, checked, disabled = false, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="app-switch"
    >
      <span className="app-switch-track" aria-hidden="true">
        <span className="app-switch-thumb" />
      </span>
    </button>
  );
}
