import { useState, useEffect, useCallback } from "react";

function currentLocation(): string {
  if (typeof window === "undefined") return "/";

  // If a hash route exists (e.g., #/painel or #login)
  const hash = window.location.hash.replace(/^#/, "");
  if (hash && hash !== "/") {
    return hash.startsWith("/") ? hash : `/${hash}`;
  }

  // Otherwise, use HTML5 pathname (e.g. /painel, /login)
  const pathname = window.location.pathname || "/";
  return pathname;
}

export function useHashLocation(): [string, (to: string, options?: { replace?: boolean }) => void] {
  const [loc, setLoc] = useState<string>(currentLocation);

  useEffect(() => {
    const updateLocation = () => setLoc(currentLocation());
    window.addEventListener("hashchange", updateLocation);
    window.addEventListener("popstate", updateLocation);

    return () => {
      window.removeEventListener("hashchange", updateLocation);
      window.removeEventListener("popstate", updateLocation);
    };
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const target = to.startsWith("/") ? to : `/${to}`;
    
    // Save last school route for session restoration if applicable
    if (
      target &&
      !target.startsWith("/master-control") &&
      target !== "/login" &&
      target !== "/cadastro" &&
      target !== "/"
    ) {
      try {
        sessionStorage.setItem("eduhorarios_last_school_route", target);
      } catch {
        // Ignore quota errors
      }
    }

    if (window.location.hash && window.location.hash !== "") {
      // Hash mode
      if (options?.replace) {
        const url = new URL(window.location.href);
        url.hash = target;
        window.history.replaceState(null, "", url.toString());
        setLoc(target);
      } else {
        window.location.hash = target;
      }
    } else {
      // HTML5 History mode
      if (options?.replace) {
        window.history.replaceState(null, "", target);
      } else {
        window.history.pushState(null, "", target);
      }
      setLoc(target);
    }
  }, []);

  return [loc, navigate];
}

