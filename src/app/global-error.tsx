'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ backgroundColor: '#09090b', color: '#fafafa', fontFamily: 'sans-serif', padding: '40px', textAlign: 'center' }}>
        <h2>Something went wrong!</h2>
        <button
          onClick={() => reset()}
          style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#a855f7', color: '#000000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
