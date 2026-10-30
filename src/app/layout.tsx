// public: the root shell; renders no data
import './commons.css';

export const metadata = { title: 'Commons' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
