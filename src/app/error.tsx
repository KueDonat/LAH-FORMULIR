'use client';

import React from 'react';

export default function ErrorComponent({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: '#fafafa' }}>
      <h2>Something went wrong!</h2>
      <button
        onClick={() => reset()}
        style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#a855f7', color: '#000000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
      >
        Try again
      </button>
    </div>
  );
}
