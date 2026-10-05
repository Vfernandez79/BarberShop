import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { getToken } from "./api";

export function useRequireAuth() {
  const nav = useNavigate();
  useEffect(() => {
    const token = getToken();
    if (!token) nav("/admin/login");
  }, [nav]);

  useEffect(() => {
    function onTokenChange() {
      const token = getToken();
      if (!token) nav("/admin/login");
    }
    window.addEventListener("bs_token_changed", onTokenChange);
    return () => window.removeEventListener("bs_token_changed", onTokenChange);
  }, [nav]);
}

