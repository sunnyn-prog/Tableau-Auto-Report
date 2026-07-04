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
  const [categoryFilter, setCategoryFilter] = useState(['Flowers', 'Combos', 'Not Found', 'Customised']);
  const [slotFilter, setSlotFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortSlotAsc, setSortSlotAsc] = useState(true);

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
      const itemsMap = new Map();
      
      querySnapshot.forEach((docSnap) => {
        const data = { id: docSnap.id, ...docSnap.data() };
        const uniqueKey = `${data.suborder_id}_${data.product_code}`;
        
        if (itemsMap.has(uniqueKey)) {
          const existing = itemsMap.get(uniqueKey);
          // Prefer the document ID that contains an underscore (the newer format)
          if (data.id.includes('_') && !existing.id.includes('_')) {
            itemsMap.set(uniqueKey, data);
          }
        } else {
          itemsMap.set(uniqueKey, data);
        }
      });
      
      const items = Array.from(itemsMap.values());
      
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
    if (dateFilter) {
      if (!s.delivery_date) return false;
      const matchesDate = s.delivery_date.startsWith(dateFilter) || 
             s.delivery_date === new Date(dateFilter).getDate().toString();
      if (!matchesDate) return false;
    }
    if (categoryFilter.length > 0 && !categoryFilter.includes(s.category)) return false;
    if (slotFilter.length > 0 && !slotFilter.includes(s.delivery_slot)) return false;
    if (statusFilter === 'Prepared' && !s.is_prepared) return false;
    if (statusFilter === 'Pending' && s.is_prepared) return false;
    return true;
  });

  const sortedSuborders = [...filteredSuborders].sort((a, b) => {
    // Always push prepared items to bottom
    if (a.is_prepared !== b.is_prepared) {
      return a.is_prepared ? 1 : -1;
    }
    // Sort by delivery slot
    const slotA = a.delivery_slot || '';
    const slotB = b.delivery_slot || '';
    if (slotA !== slotB) {
      return sortSlotAsc ? slotA.localeCompare(slotB) : slotB.localeCompare(slotA);
    }
    return (a.suborder_id || a.id).localeCompare(b.suborder_id || b.id);
  });

  const categories = ['All', ...new Set(suborders.map(s => s.category).filter(Boolean))];
  const slots = ['All', ...new Set(suborders.map(s => s.delivery_slot).filter(Boolean))];
  
  const filterStyle = {
    backgroundColor: 'rgba(0,0,0,0.3)',
    color: 'white',
    border: '1px solid var(--border)',
    padding: '0.5rem',
    borderRadius: '0.5rem',
    outline: 'none',
    fontFamily: 'inherit',
    cursor: 'pointer'
  };

  const totalOrders = filteredSuborders.length;
  const preparedCount = filteredSuborders.filter(s => s.is_prepared).length;
  const progress = totalOrders === 0 ? 0 : Math.round((preparedCount / totalOrders) * 100);

  return (
    <div className="container">
      <div className="header-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <h1>FNP Daily Orders</h1>
          <p className="subtitle" style={{ marginBottom: '1rem' }}>
            Welcome, {user.displayName} | <button onClick={() => signOut(auth)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}>Sign Out</button>
          </p>
          
          {/* Filters */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Date:</label>
              <input 
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                style={filterStyle}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Category:</label>
              <details style={{ position: 'relative' }}>
                <summary style={{...filterStyle, listStyle: 'none', cursor: 'pointer', minWidth: '130px'}}>{categoryFilter.length === 0 ? 'All Categories' : `${categoryFilter.length} Selected`}</summary>
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', backgroundColor: '#1e293b', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '0.5rem', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '200px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }}>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer', color: 'white', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={categoryFilter.length === 0} onChange={() => setCategoryFilter([])} />
                    All Categories
                  </label>
                  {categories.filter(c => c !== 'All').map(c => (
                    <label key={c} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer', color: 'white', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={categoryFilter.includes(c)} onChange={(e) => {
                        if (e.target.checked) setCategoryFilter([...categoryFilter, c]);
                        else setCategoryFilter(categoryFilter.filter(x => x !== c));
                      }} />
                      {c}
                    </label>
                  ))}
                </div>
              </details>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Slot:</label>
              <details style={{ position: 'relative' }}>
                <summary style={{...filterStyle, listStyle: 'none', cursor: 'pointer', minWidth: '100px'}}>{slotFilter.length === 0 ? 'All Slots' : `${slotFilter.length} Selected`}</summary>
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', backgroundColor: '#1e293b', border: '1px solid var(--border)', padding: '0.75rem', borderRadius: '0.5rem', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', minWidth: '200px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)' }}>
                  <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer', color: 'white', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={slotFilter.length === 0} onChange={() => setSlotFilter([])} />
                    All Slots
                  </label>
                  {slots.filter(s => s !== 'All').map(s => (
                    <label key={s} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer', color: 'white', fontSize: '0.9rem' }}>
                      <input type="checkbox" checked={slotFilter.includes(s)} onChange={(e) => {
                        if (e.target.checked) setSlotFilter([...slotFilter, s]);
                        else setSlotFilter(slotFilter.filter(x => x !== s));
                      }} />
                      {s}
                    </label>
                  ))}
                </div>
              </details>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <label style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Status:</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterStyle}>
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="Prepared">Prepared</option>
              </select>
            </div>
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
                  <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => setSortSlotAsc(!sortSlotAsc)}>
                    Date & Slot {sortSlotAsc ? '↑' : '↓'}
                  </th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedSuborders.map(sub => (
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
