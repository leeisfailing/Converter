import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function Section({ title, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="panel overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="section-header"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
          {title}
        </span>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          <ChevronDown size={14} className="text-app-text-muted" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
