import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Cloud,
  Youtube,
  Calendar,
  Settings,
  Plus,
  Play,
  CheckCircle2,
  Clock,
  LogOut,
  Sparkles,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const Sidebar = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'drive', label: 'Library', icon: Cloud },
    { id: 'schedule', label: 'Queue', icon: Calendar },
    { id: 'details', label: 'AI Refiner', icon: Sparkles },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="glass-panel sidebar">
      <div className="logo" onClick={() => setActiveTab('drive')} style={{ cursor: 'pointer' }}>V-UPLOAD AI</div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <item.icon size={20} />
            {item.label}
          </div>
        ))}
      </nav>

      <div className="nav-item" style={{ marginTop: 'auto', border: '1px solid var(--border)' }}>
        <LogOut size={20} />
        Logout
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, color }) => (
  <motion.div
    whileHover={{ y: -5 }}
    className="glass-panel stat-card"
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{title}</span>
      <div style={{ padding: '8px', borderRadius: '10px', background: `${color}15`, color: color }}>
        <Icon size={20} />
      </div>
    </div>
    <div className="stat-value">{value}</div>
  </motion.div>
);

const Modal = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backdropFilter: 'blur(8px)' }}>
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="glass-panel" style={{ width: '100%', maxWidth: '600px', padding: '40px', position: 'relative', border: '1px solid var(--border)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>✕</button>
        {children}
      </motion.div>
    </div>
  );
};

function App() {
  const [isAuth, setIsAuth] = useState(false);
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  const [driveFiles, setDriveFiles] = useState([]);
  const [scheduledVideos, setScheduledVideos] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    times: [new Date(Date.now() + 3600000).toISOString().slice(11, 16)],
    days: [],
    thumbnail: null, // Base64 thumbnail
    firstComment: ''
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('drive');
  const [showFavs, setShowFavs] = useState(false);

  const exchangeStarted = useRef(false);

  const WEEK_DAYS = [
    { id: 0, label: 'Sun' },
    { id: 1, label: 'Mon' },
    { id: 2, label: 'Tue' },
    { id: 3, label: 'Wed' },
    { id: 4, label: 'Thu' },
    { id: 5, label: 'Fri' },
    { id: 6, label: 'Sat' },
  ];

  const displayedFiles = showFavs
    ? driveFiles.filter(f => favorites.some(fav => fav.driveFileId === f.id))
    : driveFiles;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && !exchangeStarted.current) {
      exchangeStarted.current = true;
      handleCodeExchange(code);
    } else {
      initData();
    }
  }, []);

  const initData = async () => {
    try {
      await fetchData();
      await fetchSchedule();
      await fetchFavorites();
      setIsAuth(true);
    } catch {
      setIsAuth(false);
    }
  };

  const handleCodeExchange = async (code) => {
    try {
      setLoading(true);
      await axios.post(`${API_BASE}/api/auth/exchange`, { code });
      setIsAuth(true);
      window.history.replaceState({}, document.title, "/");
      toast.success("Authentication successful!");
      fetchData();
      fetchSchedule();
      fetchFavorites();
    } catch (err) {
      toast.error("Auth failed");
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/drive/videos`);
      setDriveFiles(res.data);
    } catch (err) {
      if (err.response?.status !== 401) toast.error("Drive error");
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedule = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/schedule`);
      setScheduledVideos(res.data);
    } catch (err) { }
  };

  const fetchFavorites = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/favorites`);
      setFavorites(res.data);
    } catch (err) { }
  };

  const toggleFavorite = async (file, e) => {
    e.stopPropagation();
    const isFav = favorites.find(f => f.driveFileId === file.id);
    try {
      if (isFav) {
        await axios.delete(`${API_BASE}/api/favorites/${file.id}`);
        toast.info("Removed from favorites");
      } else {
        await axios.post(`${API_BASE}/api/favorites`, {
          driveFileId: file.id,
          name: file.name,
          thumbnailLink: file.thumbnailLink
        });
        toast.success("Added to favorites");
      }
      fetchFavorites();
    } catch (err) {
      toast.error("Favorite action failed");
    }
  };

  const handleConnect = async () => {
    const response = await axios.get(`${API_BASE}/api/auth/url`);
    window.location.href = response.data.url;
  };

  const openScheduleModal = async (file) => {
    setSelectedVideo(file);
    setIsModalOpen(true);
    setLoading(true);
    try {
      const suggest = await axios.get(`${API_BASE}/api/metadata/suggest?filename=${encodeURIComponent(file.name)}`);
      setFormData({
        title: suggest.data.title,
        description: suggest.data.description,
        times: [new Date(Date.now() + 3600000).toISOString().slice(11, 16)],
        days: [new Date().getDay()],
        thumbnail: null,
        firstComment: ''
      });
    } catch (e) {
      setFormData({ title: file.name, description: '', times: ['12:00'], days: [], thumbnail: null, firstComment: '' });
    } finally {
      setLoading(false);
    }
  };

  const toggleDay = (dayId) => {
    setFormData(prev => ({
      ...prev,
      days: prev.days.includes(dayId) ? prev.days.filter(d => d !== dayId) : [...prev.days, dayId]
    }));
  };

  const addTime = () => setFormData(prev => ({ ...prev, times: [...prev.times, '12:00'] }));
  const removeTime = (idx) => setFormData(prev => ({ ...prev, times: prev.times.filter((_, i) => i !== idx) }));
  const updateTime = (idx, val) => {
    const newTimes = [...formData.times];
    newTimes[idx] = val;
    setFormData({ ...formData, times: newTimes });
  };

  const handleThumbnailChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, thumbnail: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const submitSchedule = async () => {
    if (formData.days.length === 0) return toast.error("Select at least one day");
    if (formData.times.length === 0) return toast.error("Add at least one time");

    try {
      setLoading(true);
      const schedules = [];
      const now = new Date();

      formData.days.forEach(dayIndex => {
        formData.times.forEach(timeStr => {
          let date = new Date();
          const [hours, minutes] = timeStr.split(':');

          // Calculate next occurrence of this day
          let diff = dayIndex - now.getDay();
          if (diff < 0) diff += 7;
          date.setDate(now.getDate() + diff);
          date.setHours(parseInt(hours), parseInt(minutes), 0, 0);

          // If time already passed today, move to next week
          if (date <= now) date.setDate(date.getDate() + 7);

          schedules.push({
            driveFileId: selectedVideo.id,
            title: formData.title,
            description: formData.description,
            thumbnail: formData.thumbnail,
            firstComment: formData.firstComment,
            scheduledTime: date
          });
        });
      });

      await axios.post(`${API_BASE}/api/schedule/bulk`, { schedules });
      setIsModalOpen(false);
      fetchSchedule();
      toast.success(`Successfully scheduled ${schedules.length} uploads!`);
    } catch (e) {
      toast.error("Bulk scheduling failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteJob = async (id) => {
    try {
      await axios.delete(`${API_BASE}/api/schedule/${id}`);
      fetchSchedule();
      toast.info("Job cancelled");
    } catch (e) {
      toast.error("Delete failed");
    }
  };

  return (
    <div style={{ display: 'flex' }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="main-content">
        <header className="header" style={{ marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '32px', fontWeight: '800' }}>V-Upload AI Dashboard</h1>
            <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>AI-Powered Youtube Automation Hub</p>
          </div>
          <button className="btn-primary" onClick={handleConnect}>
            <Cloud size={20} />
            {isAuth ? 'Connected to Google' : 'Connect Google Drive'}
          </button>
        </header>

        <section style={{ display: 'flex', gap: '24px', marginBottom: '40px' }}>
          <StatCard title="Successful Uploads" value={scheduledVideos.filter(v => v.status === 'Done').length} icon={CheckCircle2} color="#22c55e" />
          <StatCard title="Active Queue" value={scheduledVideos.filter(v => v.status === 'Pending').length} icon={Clock} color="#eab308" />
          <StatCard title="Failed Jobs" value={scheduledVideos.filter(v => v.status === 'Failed').length} icon={AlertCircle} color="#ef4444" />
          <StatCard title="Library Size" value={driveFiles.length} icon={Cloud} color="#8b5cf6" />
        </section>

        {activeTab === 'drive' && (
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 className="section-title">Google Drive Library</h2>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowFavs(!showFavs)}
                  className="nav-item"
                  style={{
                    border: '1px solid var(--border)',
                    background: showFavs ? 'var(--primary)' : 'transparent',
                    color: showFavs ? 'white' : 'var(--text-muted)'
                  }}
                >
                  <Star size={16} fill={showFavs ? "white" : "none"} /> {showFavs ? 'Showing Favorites' : 'Show Favorites'}
                </button>
                <button onClick={fetchData} className="nav-item" style={{ border: '1px solid var(--border)', background: 'transparent' }}>
                  <RefreshCw size={16} className={loading ? 'loading-skeleton' : ''} /> Refresh
                </button>
              </div>
            </div>
            <div className="video-grid">
              {displayedFiles.map(file => {
                const isFav = favorites.some(fav => fav.driveFileId === file.id);
                return (
                  <motion.div
                    key={file.id}
                    whileHover={{ scale: 1.02, y: -5 }}
                    className="glass-panel video-card"
                    onClick={() => openScheduleModal(file)}
                    style={{ cursor: 'pointer', position: 'relative' }}
                  >
                    <div
                      onClick={(e) => toggleFavorite(file, e)}
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        zIndex: 10,
                        background: 'rgba(0,0,0,0.4)',
                        padding: '8px',
                        borderRadius: '12px',
                        backdropFilter: 'blur(4px)',
                        color: isFav ? 'var(--primary)' : 'white',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Star size={18} fill={isFav ? "currentColor" : "none"} />
                    </div>
                    <img src={file.thumbnailLink || "https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=1000&auto=format&fit=crop"} alt={file.name} className="video-thumb" />
                    <div className="video-info">
                      <div className="video-title" style={{ fontSize: '14px' }}>{file.name}</div>
                      <div style={{ color: 'var(--primary)', fontSize: '11px', fontWeight: 800, marginTop: '8px', letterSpacing: '1px' }}>CONFIGURE UPLOAD</div>
                    </div>
                  </motion.div>
                );
              })}
              {displayedFiles.length === 0 && !loading && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '80px', border: '2px dashed var(--border)', borderRadius: '24px' }}>
                  {showFavs ? <Star size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} /> : <Cloud size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />}
                  <p style={{ color: 'var(--text-muted)' }}>{showFavs ? 'No favorites yet. Star some videos in the library!' : 'No videos found in your Drive.'}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'schedule' && (
          <section>
            <h2 className="section-title">Execution Queue</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {scheduledVideos.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No automation jobs in queue.</p>}
              {scheduledVideos.map(video => (
                <div key={video.id} className="glass-panel" style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                    <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      <Youtube size={24} color={video.status === 'Done' ? '#ef4444' : video.status === 'Failed' ? '#94a3b8' : '#8b5cf6'} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '16px' }}>{video.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                        Scheduled: {new Date(video.scheduledTime).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', gap: '24px', alignItems: 'center' }}>
                    <div className={`status-badge ${video.status === 'Done' ? 'status-done' : video.status === 'Failed' ? 'status-error' : 'status-pending'}`}>
                      {video.status}
                    </div>
                    {video.status === 'Pending' && (
                      <button onClick={() => deleteJob(video.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                    )}
                    {video.youtubeId && (
                      <div style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600, cursor: 'pointer' }} onClick={() => window.open(`https://youtube.com/watch?v=${video.youtubeId}`)}>
                        VIEW ↗
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
          <h2 style={{ marginBottom: '24px', fontSize: '24px' }}>Smart Multi-Schedule</h2>
          {loading && !formData.title ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Sparkles size={40} className="loading-skeleton" style={{ color: 'var(--primary)', marginBottom: '16px' }} />
              <p style={{ color: 'var(--text-muted)' }}>Initializing AI Engine...</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxHeight: '70vh', overflowY: 'auto', paddingRight: '10px' }}>
              <div>
                <label className="modal-label">YouTube Title</label>
                <input className="modal-input" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
              </div>

              <div>
                <label className="modal-label">Upload Days (Select Multiple)</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {WEEK_DAYS.map(day => (
                    <button
                      key={day.id}
                      onClick={() => toggleDay(day.id)}
                      className={`day-chip ${formData.days.includes(day.id) ? 'active' : ''}`}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label className="modal-label">Upload Times (Select Multiple)</label>
                  <button onClick={addTime} className="btn-secondary" style={{ padding: '4px 8px' }}><Plus size={14} /> Add Time</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {formData.times.map((time, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <input
                        type="time"
                        className="modal-input"
                        value={time}
                        onChange={(e) => updateTime(idx, e.target.value)}
                        style={{ flex: 1 }}
                      />
                      {formData.times.length > 1 && (
                        <button onClick={() => removeTime(idx)} style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="modal-label">Custom Thumbnail (Optional)</label>
                <div
                  onClick={() => document.getElementById('thumb-input').click()}
                  style={{
                    marginTop: '8px',
                    width: '100%',
                    aspectRatio: '16/9',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px dashed var(--border)',
                    borderRadius: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  {formData.thumbnail ? (
                    <img src={formData.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <>
                      <Plus size={32} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
                      <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Click to upload thumbnail</span>
                    </>
                  )}
                  <input id="thumb-input" type="file" accept="image/*" hidden onChange={handleThumbnailChange} />
                </div>
              </div>

              <div>
                <label className="modal-label">First Comment (Pinned Automatically)</label>
                <textarea
                  className="modal-input"
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  placeholder="Write a comment to pin..."
                  value={formData.firstComment}
                  onChange={e => setFormData({ ...formData, firstComment: e.target.value })}
                />
              </div>

              <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(139, 92, 246, 0.05)', border: '1px dashed var(--primary)' }}>
                <p style={{ fontSize: '13px', color: 'var(--primary)', margin: 0 }}>
                  💡 This will create <strong>{formData.days.length * formData.times.length}</strong> separate upload jobs.
                </p>
              </div>

              <button className="btn-primary" onClick={submitSchedule} style={{ width: '100%', padding: '16px' }} disabled={loading}>
                {loading ? 'Processing...' : <><Calendar size={20} /> Schedule Automation Jobs</>}
              </button>
            </div>
          )}
        </Modal>
        <ToastContainer position="bottom-right" theme="dark" />
      </main>
    </div>
  );
}


export default App;
