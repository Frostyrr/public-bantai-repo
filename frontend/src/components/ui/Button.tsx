import React from 'react';
import { Link } from 'react-router-dom';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Optional React Router destination path */
  to?: string;
  /** Optional location state for React Router Link */
  state?: unknown;
  /** Optional external website URL */
  href?: string;
  /** Button visual style variant */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'glass' | 'danger';
  /** Button sizing preset */
  size?: 'sm' | 'md' | 'lg';
  /** Optional icon to display on the left side */
  icon?: React.ReactNode;
  /** Optional icon to display on the right side */
  iconRight?: React.ReactNode;
  /** Optional loading state displaying a spinner */
  isLoading?: boolean;
  /** Button type for forms */
  type?: 'button' | 'submit' | 'reset';
  /** Optional custom CSS classes */
  className?: string;
  /** Target attribute for external link (e.g. '_blank') */
  target?: string;
  /** Rel attribute for external link */
  rel?: string;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  to,
  state,
  href,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  isLoading = false,
  type = 'button',
  className = '',
  disabled,
  children,
  target,
  rel,
  ...props
}) => {
  const isButtonDisabled = disabled || isLoading;

  // Base button styles following Geist typography & minimal design principles
  const baseStyles =
    'inline-flex items-center justify-center gap-2 font-normal font-body transition-[color,background-color,border-color,opacity,transform] duration-150 motion-reduce:transition-none motion-reduce:active:scale-100 cursor-pointer select-none active:scale-[0.99] hardware-sharp focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none rounded-full group';

  // Sizing styles
  const sizeStyles = {
    sm: 'px-4 py-1.5 text-xs sm:text-sm',
    md: 'px-6 py-2.5 text-sm',
    lg: 'px-8 py-3.5 text-base',
  }[size];

  // Variants according to modern aesthetic guidelines
  const variantStyles = {
    primary:
      'bg-action text-action-fg hover:opacity-90 font-medium rounded-full shadow-(--shadow-pill) dark:shadow-[0_0_20px_rgba(255,255,255,0.08)] dark:hover:shadow-[0_0_24px_rgba(255,255,255,0.18)]',
    secondary:
      'bg-surface text-primary hover:bg-hover-surface border border-subtle hover:border-strong rounded-full shadow-(--shadow-pill) dark:bg-elevated dark:hover:bg-surface dark:shadow-sm',
    outline:
      'bg-transparent text-primary border border-strong hover:bg-elevated rounded-full',
    ghost:
      'bg-transparent text-secondary hover:text-primary hover:bg-elevated rounded-full',
    glass:
      'bg-surface text-primary hover:bg-hover-surface border border-subtle hover:border-strong rounded-full shadow-(--shadow-pill) dark:hover:bg-elevated dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_2px_8px_rgba(0,0,0,0.4)]',
    danger:
      'bg-danger-action text-white hover:bg-danger-action-hover rounded-full shadow-sm disabled:opacity-60',
  }[variant];

  const combinedClasses = `${baseStyles} ${sizeStyles} ${variantStyles} ${className}`;

  const content = (
    <>
      {isLoading ? (
        <svg
          className="animate-spin h-4 w-4 text-current shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        icon && <span className="inline-flex items-center shrink-0">{icon}</span>
      )}
      <span>{children}</span>
      {!isLoading && iconRight && (
        <span className="inline-flex items-center shrink-0 transition-transform group-hover:translate-x-0.5">
          {iconRight}
        </span>
      )}
    </>
  );

  // 1. If 'to' prop is provided, render React Router Link (Internal Routing)
  if (to) {
    return (
      <Link to={to} state={state} className={combinedClasses}>
        {content}
      </Link>
    );
  }

  // 2. If 'href' prop is provided, render external HTML Anchor (Website Link)
  if (href) {
    return (
      <a
        href={href}
        target={target || (href.startsWith('http') ? '_blank' : undefined)}
        rel={rel || (href.startsWith('http') ? 'noopener noreferrer' : undefined)}
        className={combinedClasses}
      >
        {content}
      </a>
    );
  }

  // 3. Fallback: Standard HTML Button
  return (
    <button
      type={type}
      disabled={isButtonDisabled}
      className={combinedClasses}
      {...props}
    >
      {content}
    </button>
  );
};

export default Button;
