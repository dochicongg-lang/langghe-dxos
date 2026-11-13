import AuthProvider from "@/components/AuthProvider";
import ShellFrame from "@/components/ShellFrame";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ShellFrame>{children}</ShellFrame>
    </AuthProvider>
  );
}
