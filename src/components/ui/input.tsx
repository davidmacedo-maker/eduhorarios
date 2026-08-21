import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base e Alinhamento
          "flex h-9 w-full rounded-md border px-3 py-1 text-sm font-medium transition-all duration-100",
          // Cores e Superfície (Integrado do seu input.tsx)
          "border-input bg-card text-foreground shadow-2xs placeholder:text-muted-foreground/70",
          // Reset de Estados Nativos
          "focus:outline-none focus-visible:outline-none",
          // Estado de Foco customizado por variáveis de tema
          "focus:border-[has-slot]/[--primary-border] focus:ring-0",
          // Elementos de arquivo e Estados Desabilitados
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
