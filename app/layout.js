import "./globals.css";

export const metadata = {
  title: "DebtAware — Make room for what’s next",
  description:
    "Explore a clearer path from your current debt to your next major purchase.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
