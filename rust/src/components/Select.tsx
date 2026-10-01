import { forwardRef, type SelectHTMLAttributes } from "react";

/** Native keyboard interaction with consistent styling in both webviews. */
const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return <select ref={ref} {...props} className={`select ${className}`} />;
  },
);

export default Select;
