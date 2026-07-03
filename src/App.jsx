import React, { useState, useEffect } from 'react';
import { auth, provider, db } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, updateDoc, query, orderBy } from 'firebase/firestore';
import './index.css';

// Helper to get dates for default filters
const getFutureDate = (daysAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
};

function App() {
  const [user, setUser] = useState(null);
  const [suborders, setSuborders] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Default to tomorrow's date
  const [dateFilter, setDateFilter] = useState(getFutureDate(1));

  useEffect(() => {
    // Listen for Auth changes
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setSuborders([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    // Real-time listener for Firestore suborders
    const q = query(collection(db, 'suborders'));
    const unsubscribeData = onSnapshot(q, (querySnapshot) => {
      const items = [];
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      // Sort by status, then ID (mock sorting)
      items.sort((a, b) => {
        if (a.is_prepared === b.is_prepared) return a.id.localeCompare(b.id);
        return a.is_prepared ? 1 : -1;
      });
      setSuborders(items);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching suborders:", error);
      setLoading(false);
    });

    return () => unsubscribeData();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const togglePrepared = async (id, currentStatus) => {
    try {
      const docRef = doc(db, 'suborders', id);
      await updateDoc(docRef, {
        is_prepared: !currentStatus,
        prepared_by: !currentStatus ? user.displayName : null,
        prepared_at: !currentStatus ? new Date().toISOString() : null
      });
    } catch (error) {
      console.error("Error updating suborder", error);
    }
  };

  if (!user) {
    return (
      <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: '400px' }}>
          <h1>TBP Portal</h1>
          <p className="subtitle">Please sign in to manage suborders</p>
          <button 
            onClick={handleLogin}
            style={{
              background: 'white',
              color: 'black',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
            }}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // Parse delivery date strings correctly for filtering
  const filteredSuborders = suborders.filter(s => {
    if (!dateFilter) return true;
    if (!s.delivery_date) return false;
    return s.delivery_date.startsWith(dateFilter) || 
           s.delivery_date === new Date(dateFilter).getDate().toString();
  });

  const totalOrders = filteredSuborders.length;
  const preparedCount = filteredSuborders.filter(s => s.is_prepared).length;
  const progress = totalOrders === 0 ? 0 : Math.round((preparedCount / totalOrders) * 100);

  return (
    <div className="container">
      <div className="header-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1>TBP Preparation Portal</h1>
          <p className="subtitle" style={{ marginBottom: '1rem' }}>
            Welcome, {user.displayName} | <button onClick={() => signOut(auth)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}>Sign Out</button>
          </p>
          
          {/* Filters */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Delivery Date:</label>
            <input 
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              style={{
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: 'white',
                border: '1px solid var(--border)',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                outline: 'none',
                fontFamily: 'inherit',
                cursor: 'pointer'
              }}
            />
          </div>
        </div>
        
        <div className="stats">
          <div className="stat-item">
            <span className="stat-value">{totalOrders}</span>
            <span className="stat-label">Total Items</span>
          </div>
          <div className="stat-item">
            <span className="stat-value" style={{ color: 'var(--success)' }}>{preparedCount}</span>
            <span className="stat-label">Prepared</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{progress}%</span>
            <span className="stat-label">Progress</span>
          </div>
        </div>
      </div>

      <div className="glass-card">
        {loading ? (
          <div className="loader-container">
            <div className="spinner"></div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Prepared</th>
                  <th>Suborder ID</th>
                  <th>Date & Slot</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuborders.map(sub => (
                  <tr key={sub.id} className={sub.is_prepared ? 'is-prepared' : ''}>
                    <td style={{ width: '80px', textAlign: 'center' }}>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={sub.is_prepared || false} 
                          onChange={() => togglePrepared(sub.id, sub.is_prepared)}
                        />
                        <span className="slider"></span>
                      </label>
                    </td>
                    <td>
                      <div style={{ fontWeight: '500' }}>{sub.suborder_id || sub.id}</div>
                    </td>
                    <td>
                       <span className="badge" style={{ backgroundColor: 'rgba(59,130,246,0.2)', color: 'var(--accent)', border: 'none', marginBottom: '4px' }}>
                         {sub.delivery_date?.length > 2 ? new Date(sub.delivery_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Day ' + sub.delivery_date}
                       </span>
                       {sub.delivery_slot && (
                         <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                           {sub.delivery_slot}
                         </div>
                       )}
                    </td>
                    <td>
                      <div className="product-cell">
                        {sub.image_url && sub.image_url !== 'NA' ? (
                          <img src={sub.image_url} alt={sub.product_name} className="product-img" />
                        ) : (
                          <div className="product-img"></div>
                        )}
                        <div className="product-details">
                          <span className="product-name">{sub.product_name}</span>
                          <span className="product-code">{sub.product_code}</span>
                        </div>
                      </div>
                    </td>
                    <td>{sub.category}</td>
                    <td style={{ fontWeight: '600', fontSize: '1.1rem' }}>{sub.qty}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span className={`badge ${sub.is_prepared ? 'prepared' : ''}`} style={{ width: 'fit-content' }}>
                          {sub.is_prepared ? 'Ready' : 'Pending'}
                        </span>
                        {sub.prepared_by && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                            by {sub.prepared_by}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSuborders.length === 0 && (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      No suborders found in database for this date.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
