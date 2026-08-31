export const metadata = { title: "Katha — Watch", description: "Micro-dramas in your language." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body style={{ margin: 0 }}>{children}</body></html>);
}
