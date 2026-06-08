export const metadata = {
  title: "mw-whatsapp",
  description: "WhatsApp booking webhook",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
