/** 開關（role="switch"）；名稱由 label 或 labelledBy 提供 */
export function Toggle({
  checked,
  onChange,
  label,
  labelledBy,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  labelledBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      className="vf-toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="vf-toggle-knob" aria-hidden="true" />
    </button>
  );
}
