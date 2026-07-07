import React, { useState, useEffect } from 'react';
import { auth, provider, db } from './firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, updateDoc, query, orderBy, setDoc } from 'firebase/firestore';
import './index.css';

const defaultColumns = [
  'prepared',
  'suborder_id',
  'date_slot',
  'product',
  'category',
  'special_instructions',
  'qty',
  'status'
];

// Helper to get dates for default filters
const getFutureDate = (daysAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function App() {
  const [user, setUser] = useState(null);
  const [suborders, setSuborders] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Default to tomorrow's date
  const [dateFilter, setDateFilter] = useState(getFutureDate(1));
  const [categoryFilter, setCategoryFilter] = useState(['Flowers', 'Combos', 'Not Found', 'Customised', 'Flower Fruit Hamper', 'Flower Snack Hamper']);
  const [slotFilter, setSlotFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortSlotAsc, setSortSlotAsc] = useState(true);
  const [columns, setColumns] = useState(defaultColumns);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [viewMode, setViewMode] = useState('orders'); // 'orders' or 'summary'

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
        const cleanSub = String(data.suborder_id || data.id || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const cleanProd = String(data.product_code || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const uniqueKey = `${cleanSub}_${cleanProd}`;
        
        if (itemsMap.has(uniqueKey)) {
          const existing = itemsMap.get(uniqueKey);
          
          const newTime = data.last_updated?.seconds || 0;
          const oldTime = existing.last_updated?.seconds || 0;
          
          // Always keep the most recently updated document from Tableau
          if (newTime > oldTime) {
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

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'settings', 'tableConfig'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().columns) {
        setColumns(docSnap.data().columns);
      }
    });
    return () => unsub();
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

  const saveColumnLayout = async () => {
    try {
      await setDoc(doc(db, 'settings', 'tableConfig'), { columns }, { merge: true });
      alert("Column layout saved and synced to all users!");
    } catch (e) {
      console.error(e);
      alert("Error saving layout: " + e.message);
    }
  };

  const handleDragStart = (e, colId) => {
    setDraggedColumn(colId);
    e.dataTransfer.effectAllowed = "move";
  };
  
  const handleDragOver = (e, targetColId) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColId) return;
    
    const newCols = [...columns];
    const draggedIdx = newCols.indexOf(draggedColumn);
    const targetIdx = newCols.indexOf(targetColId);
    
    newCols.splice(draggedIdx, 1);
    newCols.splice(targetIdx, 0, draggedColumn);
    
    setColumns(newCols);
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
  
  const productSummaryList = (() => {
    const summaryMap = {};
    filteredSuborders.forEach(sub => {
      const code = sub.product_code || 'Unknown';
      if (!summaryMap[code]) {
        summaryMap[code] = {
          code,
          name: sub.product_name,
          image_url: sub.image_url,
          totalQty: 0
        };
      }
      summaryMap[code].totalQty += parseInt(sub.qty || 1, 10);
    });
    return Object.values(summaryMap).sort((a, b) => b.totalQty - a.totalQty);
  })();
  
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

  const preparedSummary = {};
  filteredSuborders.forEach(sub => {
    if (sub.is_prepared) {
      const name = sub.prepared_by || 'Unknown';
      preparedSummary[name] = (preparedSummary[name] || 0) + 1;
    }
  });

  const downloadCSV = () => {
    if (sortedSuborders.length === 0) return;
    
    const headers = ['Suborder ID', 'Date', 'Slot', 'Product Name', 'Product Code', 'Category', 'Special Instructions', 'Qty', 'Status', 'Prepared By'];
    
    const csvRows = sortedSuborders.map(sub => {
      const dateStr = sub.delivery_date?.length > 2 ? new Date(sub.delivery_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Day ' + sub.delivery_date;
      return [
        `"${sub.suborder_id || sub.id}"`,
        `"${dateStr}"`,
        `"${sub.delivery_slot || ''}"`,
        `"${(sub.product_name || '').replace(/"/g, '""')}"`,
        `"${sub.product_code || ''}"`,
        `"${sub.category || ''}"`,
        `"${(sub.special_instructions || '').replace(/"/g, '""')}"`,
        sub.qty || 1,
        `"${sub.is_prepared ? 'Prepared' : 'Pending'}"`,
        `"${sub.prepared_by || ''}"`
      ].join(',');
    });
    
    const csvString = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `FNP_Orders_${dateFilter || 'All'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="container">
      <div className="header-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>FNP Daily Orders</h1>
            <a 
              href="https://github.com/sunnyn-prog/Tableau-Auto-Report/actions/workflows/tbp_sync.yml" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: 'var(--accent)',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                textDecoration: 'none',
                fontWeight: '600',
                fontSize: '0.9rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                transition: 'all 0.2s'
              }}
              title="Click to run the Sync workflow on GitHub"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M21.34 15.57a10 10 0 1 1-.59-9.21l-5.67 5.67M2.66 8.43a10 10 0 1 1 .59 9.21l5.67-5.67"/>
              </svg>
              Sync Tableau Orders
            </a>
            <button 
              onClick={downloadCSV}
              style={{
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                color: 'var(--success)',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.9rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'all 0.2s',
                fontFamily: 'inherit'
              }}
              title="Download filtered orders as CSV"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Download CSV
            </button>
            {viewMode === 'summary' && (
              <button 
                onClick={handlePrint}
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--text-main)',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.9rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  transition: 'all 0.2s',
                  fontFamily: 'inherit'
                }}
                title="Print Summary"
                className="hide-on-print"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"></polyline>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                  <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                Print Summary
              </button>
            )}
            <button 
              onClick={() => setViewMode(viewMode === 'orders' ? 'summary' : 'orders')}
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                color: 'var(--primary)',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.9rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'all 0.2s',
                fontFamily: 'inherit'
              }}
              title="Toggle Product Summary View"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
              {viewMode === 'orders' ? 'PID Summary' : 'Detailed Orders'}
            </button>
          </div>
          <p className="subtitle" style={{ marginBottom: '1rem', marginTop: '0.5rem' }}>
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

      {['sunny.n@fnp.sg', 'belle.t@fnp.sg', 'sawan.k@fnp.sg'].includes(user.email) && (
        <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: Object.keys(preparedSummary).length > 0 ? '0.75rem' : 0 }}>
             <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text)' }}>Admin Controls</h3>
             <button onClick={saveColumnLayout} style={{ backgroundColor: 'var(--primary)', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' }}>Save Column Layout</button>
          </div>
          {Object.keys(preparedSummary).length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {Object.entries(preparedSummary).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                <div key={name} style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', padding: '0.5rem 1rem', borderRadius: '0.5rem', color: 'white', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600' }}>{name}</span>
                  <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.1rem 0.5rem', borderRadius: '1rem', fontSize: '0.8rem' }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="glass-card">
        {loading ? (
          <div className="loader-container">
            <div className="spinner"></div>
          </div>
        ) : viewMode === 'summary' ? (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Product Image</th>
                  <th>Total Qty</th>
                  <th>Product Description</th>
                </tr>
              </thead>
              <tbody>
                {productSummaryList.map(prod => (
                  <tr key={prod.code}>
                    <td style={{ width: '100px' }}>
                      {prod.image_url && prod.image_url !== 'NA' ? (
                        <img src={prod.image_url} alt={prod.name} className="product-img" />
                      ) : (
                        <div className="product-img"></div>
                      )}
                    </td>
                    <td style={{ fontWeight: '600', fontSize: '1.4rem', color: 'var(--accent)', width: '120px' }}>
                      {prod.totalQty}
                    </td>
                    <td>
                      <div className="product-details" style={{ marginLeft: 0 }}>
                        <span className="product-name" style={{ fontSize: '1.1rem' }}>{prod.name}</span>
                        <span className="product-code">{prod.code}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {productSummaryList.length === 0 && (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      No products found for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  {columns.map(colId => {
                    const isDraggable = ['sunny.n@fnp.sg', 'belle.t@fnp.sg', 'sawan.k@fnp.sg'].includes(user?.email);
                    const dragProps = isDraggable ? {
                      draggable: true,
                      onDragStart: (e) => handleDragStart(e, colId),
                      onDragOver: (e) => handleDragOver(e, colId),
                      style: { cursor: 'grab' }
                    } : {};
                    
                    switch(colId) {
                      case 'prepared': return <th key={colId} {...dragProps}>Prepared</th>;
                      case 'suborder_id': return <th key={colId} {...dragProps}>Suborder ID</th>;
                      case 'date_slot': return (
                        <th key={colId} {...dragProps} style={{ ...(dragProps.style || {}), cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => setSortSlotAsc(!sortSlotAsc)}>
                           Date & Slot {sortSlotAsc ? '↑' : '↓'}
                        </th>
                      );
                      case 'product': return <th key={colId} {...dragProps}>Product</th>;
                      case 'category': return <th key={colId} {...dragProps}>Category</th>;
                      case 'special_instructions': return <th key={colId} {...dragProps}>Special Instructions</th>;
                      case 'qty': return <th key={colId} {...dragProps}>Qty</th>;
                      case 'status': return <th key={colId} {...dragProps}>Status</th>;
                      default: return null;
                    }
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedSuborders.map(sub => (
                  <tr key={sub.id} className={sub.is_prepared ? 'is-prepared' : ''}>
                    {columns.map(colId => {
                      switch(colId) {
                        case 'prepared': return (
                          <td key={colId} style={{ width: '80px', textAlign: 'center' }}>
                            <label className="switch">
                              <input 
                                type="checkbox" 
                                checked={sub.is_prepared || false} 
                                onChange={() => togglePrepared(sub.id, sub.is_prepared)}
                              />
                              <span className="slider"></span>
                            </label>
                          </td>
                        );
                        case 'suborder_id': return (
                          <td key={colId}>
                            <div style={{ fontWeight: '500' }}>{sub.suborder_id || sub.id}</div>
                          </td>
                        );
                        case 'date_slot': return (
                          <td key={colId}>
                             <span className="badge" style={{ backgroundColor: 'rgba(59,130,246,0.2)', color: 'var(--accent)', border: 'none', marginBottom: '4px' }}>
                               {sub.delivery_date?.length > 2 ? new Date(sub.delivery_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Day ' + sub.delivery_date}
                             </span>
                             {sub.delivery_slot && (
                               <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                 {sub.delivery_slot}
                               </div>
                             )}
                          </td>
                        );
                        case 'product': return (
                          <td key={colId}>
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
                        );
                        case 'category': return <td key={colId}>{sub.category}</td>;
                        case 'special_instructions': return (
                          <td key={colId}>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '200px', whiteSpace: 'normal', wordWrap: 'break-word' }}>
                              {sub.special_instructions && sub.special_instructions.toLowerCase() !== 'null' ? sub.special_instructions : '-'}
                            </div>
                          </td>
                        );
                        case 'qty': return <td key={colId} style={{ fontWeight: '600', fontSize: '1.1rem' }}>{sub.qty}</td>;
                        case 'status': return (
                          <td key={colId}>
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
                        );
                        default: return null;
                      }
                    })}
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
