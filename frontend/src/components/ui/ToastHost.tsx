import { useEffect } from "react";
import { prepareNotificationAudio } from "../../lib/notificationSound";
import { Toaster } from "sonner";
import { CheckCircle2, CircleX, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import "./toast.css";

export default function ToastHost() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    document.addEventListener("click", prepareNotificationAudio);
    document.addEventListener("keydown", prepareNotificationAudio);
    return () => {
      document.removeEventListener("click", prepareNotificationAudio);
      document.removeEventListener("keydown", prepareNotificationAudio);
    };
  }, []);
  return <Toaster theme={resolvedTheme} position="bottom-right" closeButton duration={3800}
    offset={{ top: 72, bottom: 24, right: 24 }} mobileOffset={{ top: "calc(72px + env(safe-area-inset-top))", bottom: "calc(16px + env(safe-area-inset-bottom))", left: 16, right: 16 }}
    icons={{
      success: <CheckCircle2 size={17} className="text-sem-success-fg" />,
      error: <CircleX size={17} className="text-sem-error-fg" />,
      warning: <TriangleAlert size={17} className="text-sem-warning-fg" />,
      info: <Info size={17} className="text-secondary" />,
      loading: <LoaderCircle size={17} className="motion-safe:animate-spin" />,
    }}
    toastOptions={{ classNames: { toast: "bantai-toast", description: "text-secondary!" } }} />;
}
