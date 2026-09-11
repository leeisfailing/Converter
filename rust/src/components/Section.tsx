import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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
      >
        <span className="text-xs font-semibold text-app-text-secondary uppercase tracking-wider">
          {title}
        </span>
        {open ? (
          <ChevronDown size={14} className="text-app-text-muted" />
        ) : (
          <ChevronRight size={14} className="text-app-text-muted" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
