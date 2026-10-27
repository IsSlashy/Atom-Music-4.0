export interface ForwardButtonProps {
  onClick?: (e: MouseEvent) => void;
  title: string;
  disabled?: boolean;
}

export const ForwardButton = (props: ForwardButtonProps) => (
  <button
    aria-label={props.title}
    class="ytmd-history-button"
    disabled={props.disabled}
    onClick={(e) => props.onClick?.(e)}
    title={props.title}
    type="button"
  >
    <svg
      aria-hidden="true"
      class="ytmd-history-icon"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 492 492"
    >
      <path
        d="M382.7,226.8L163.7,7.9c-5.1-5.1-11.8-7.9-19-7.9s-14,2.8-19,7.9L109.5,24c-10.5,10.5-10.5,27.6,0,38.1
                l183.9,183.9L109.3,430c-5.1,5.1-7.9,11.8-7.9,19c0,7.2,2.8,14,7.9,19l16.1,16.1c5.1,5.1,11.8,7.9,19,7.9s14-2.8,19-7.9L382.7,265
                c5.1-5.1,7.9-11.9,7.8-19.1C390.5,238.7,387.8,231.9,382.7,226.8z"
      />
    </svg>
  </button>
);
