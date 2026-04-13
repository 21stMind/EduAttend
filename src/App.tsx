/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  serverTimestamp,
  getDocs,
  orderBy,
  limit,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { 
  QrCode, 
  LogOut, 
  User, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Users, 
  BookOpen, 
  FileText, 
  Plus, 
  Search,
  ChevronRight,
  LayoutDashboard,
  Clock,
  MapPin,
  Menu,
  X,
  Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isSameDay, startOfDay, endOfDay } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { cn } from './lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

// --- Types ---

type UserRole = 'student' | 'teacher' | 'admin';

interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  classId?: string;
  subjectIds?: string[];
}

interface ClassData {
  id: string;
  name: string;
}

interface SubjectData {
  id: string;
  name: string;
  code: string;
}

interface ScheduleEntry {
  id: string;
  classId: string;
  subjectId: string;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
}

interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  classId: string;
  subjectId: string;
  date: string;
  status: 'present' | 'absent';
  timestamp: any;
  method: 'qr' | 'manual';
}

// --- Components ---

const LoadingScreen = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-slate-50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-600 font-medium">Loading EduAttend...</p>
    </div>
  </div>
);

const Login = () => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('student');

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      const userRef = doc(db, 'users', user.uid);
      
      // For testing purposes, we'll update the role to the selected one on every login
      // Note: In a production app, roles should be managed by admins only.
      await setDoc(userRef, {
        uid: user.uid,
        name: user.displayName || 'User',
        email: user.email,
        role: selectedRole
      }, { merge: true });
      
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center"
      >
        <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
          <QrCode className="text-white w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">EduAttend</h1>
        <p className="text-slate-500 mb-8">Smart attendance management for modern schools</p>
        
        <div className="space-y-4 mb-8">
          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">Select Testing Role</p>
          <div className="grid grid-cols-3 gap-2">
            {(['student', 'teacher', 'admin'] as const).map((role) => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={cn(
                  "py-2 px-3 rounded-xl text-xs font-bold capitalize border-2 transition-all",
                  selectedRole === role 
                    ? "bg-blue-50 border-blue-600 text-blue-600" 
                    : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                )}
              >
                {role}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-blue-600 text-white font-bold py-4 px-4 rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5 brightness-0 invert" />
          Login as {selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}
        </button>
        
        <p className="mt-6 text-xs text-slate-400">
          Role selection is enabled for testing purposes.
        </p>
      </motion.div>
    </div>
  );
};

// --- Student Dashboard ---

const StudentDashboard = ({ user }: { user: UserProfile }) => {
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [subjects, setSubjects] = useState<Record<string, SubjectData>>({});
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (!user.classId) return;

    const qSchedule = query(collection(db, 'schedules'), where('classId', '==', user.classId));
    const unsubSchedule = onSnapshot(qSchedule, (snap) => {
      setSchedule(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleEntry)));
    });

    const qAttendance = query(collection(db, 'attendance'), where('studentId', '==', user.uid));
    const unsubAttendance = onSnapshot(qAttendance, (snap) => {
      setAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord)));
    });

    const unsubSubjects = onSnapshot(collection(db, 'subjects'), (snap) => {
      const subMap: Record<string, SubjectData> = {};
      snap.docs.forEach(doc => {
        subMap[doc.id] = doc.data() as SubjectData;
      });
      setSubjects(subMap);
    });

    return () => {
      unsubSchedule();
      unsubAttendance();
      unsubSubjects();
    };
  }, [user.classId, user.uid]);

  const handleScan = async (decodedText: string) => {
    try {
      const qrData = JSON.parse(decodedText);
      if (qrData.type === 'attendance' && qrData.classId === user.classId) {
        // Record attendance
        const today = format(new Date(), 'yyyy-MM-dd');
        
        // Check if already recorded
        const existing = attendance.find(a => a.date === today && a.subjectId === qrData.subjectId);
        if (existing) {
          alert('Attendance already recorded for this subject today!');
          return;
        }

        await addDoc(collection(db, 'attendance'), {
          studentId: user.uid,
          studentName: user.name,
          classId: user.classId,
          subjectId: qrData.subjectId,
          date: today,
          status: 'present',
          timestamp: serverTimestamp(),
          method: 'qr'
        });
        
        alert('Attendance recorded successfully!');
        setIsScanning(false);
      }
    } catch (error) {
      console.error('Scan error:', error);
    }
  };

  useEffect(() => {
    if (isScanning) {
      scannerRef.current = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
      scannerRef.current.render(handleScan, (err) => {});
    } else {
      scannerRef.current?.clear();
    }
    return () => scannerRef.current?.clear();
  }, [isScanning]);

  const todaySchedule = schedule.filter(s => s.day === format(new Date(), 'EEEE'));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Welcome, {user.name}</h2>
        <button 
          onClick={() => setIsScanning(!isScanning)}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl font-semibold transition-all shadow-sm",
            isScanning ? "bg-red-100 text-red-600" : "bg-blue-600 text-white hover:bg-blue-700"
          )}
        >
          {isScanning ? <X className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
          {isScanning ? "Close Scanner" : "Check In"}
        </button>
      </div>

      <AnimatePresence>
        {isScanning && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-2xl p-4 shadow-inner border border-slate-100 overflow-hidden"
          >
            <div id="reader" className="w-full max-w-sm mx-auto rounded-xl overflow-hidden" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Today's Schedule */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="text-blue-600 w-5 h-5" />
            <h3 className="font-bold text-slate-800">Today's Schedule</h3>
          </div>
          <div className="space-y-3">
            {todaySchedule.length > 0 ? todaySchedule.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-semibold text-slate-900">{subjects[s.subjectId]?.name || 'Loading...'}</p>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {s.startTime} - {s.endTime}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-slate-600 flex items-center gap-1 justify-end">
                    <MapPin className="w-3 h-3" /> {s.room}
                  </p>
                </div>
              </div>
            )) : (
              <p className="text-center text-slate-400 py-4">No classes today</p>
            )}
          </div>
        </div>

        {/* Attendance Summary */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="text-green-600 w-5 h-5" />
            <h3 className="font-bold text-slate-800">Recent Attendance</h3>
          </div>
          <div className="space-y-3">
            {attendance.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-semibold text-slate-900">{subjects[a.subjectId]?.name}</p>
                  <p className="text-xs text-slate-500">{format(new Date(a.date), 'MMM dd, yyyy')}</p>
                </div>
                <span className={cn(
                  "px-2 py-1 rounded-lg text-xs font-bold uppercase",
                  a.status === 'present' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                )}>
                  {a.status}
                </span>
              </div>
            ))}
            {attendance.length === 0 && (
              <p className="text-center text-slate-400 py-4">No attendance records yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Teacher Dashboard ---

const TeacherDashboard = ({ user }: { user: UserProfile }) => {
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    const unsubClasses = onSnapshot(collection(db, 'classes'), (snap) => {
      setClasses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClassData)));
    });

    const unsubSubjects = onSnapshot(collection(db, 'subjects'), (snap) => {
      const allSubs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubjectData));
      setSubjects(allSubs.filter(s => user.subjectIds?.includes(s.id)));
    });

    return () => {
      unsubClasses();
      unsubSubjects();
    };
  }, [user.subjectIds]);

  useEffect(() => {
    if (!selectedClass) return;
    const q = query(collection(db, 'users'), where('classId', '==', selectedClass), where('role', '==', 'student'));
    const unsub = onSnapshot(q, (snap) => {
      setStudents(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });
    return unsub;
  }, [selectedClass]);

  useEffect(() => {
    if (!selectedClass || !selectedSubject) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const q = query(
      collection(db, 'attendance'), 
      where('classId', '==', selectedClass),
      where('subjectId', '==', selectedSubject),
      where('date', '==', today)
    );
    const unsub = onSnapshot(q, (snap) => {
      setAttendanceRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord)));
    });
    return unsub;
  }, [selectedClass, selectedSubject]);

  const toggleAttendance = async (student: UserProfile) => {
    if (!selectedClass || !selectedSubject) return;
    
    const today = format(new Date(), 'yyyy-MM-dd');
    const existing = attendanceRecords.find(a => a.studentId === student.uid);

    if (existing) {
      // Toggle to absent or delete? Let's toggle status
      await setDoc(doc(db, 'attendance', existing.id), {
        ...existing,
        status: existing.status === 'present' ? 'absent' : 'present',
        timestamp: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'attendance'), {
        studentId: student.uid,
        studentName: student.name,
        classId: selectedClass,
        subjectId: selectedSubject,
        date: today,
        status: 'present',
        timestamp: serverTimestamp(),
        method: 'manual'
      });
    }
  };

  const qrValue = JSON.stringify({
    type: 'attendance',
    classId: selectedClass,
    subjectId: selectedSubject,
    date: format(new Date(), 'yyyy-MM-dd')
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-slate-900">Teacher Dashboard</h2>
        <div className="flex gap-2">
          <select 
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium"
            value={selectedClass || ''}
            onChange={(e) => setSelectedClass(e.target.value)}
          >
            <option value="">Select Class</option>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select 
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium"
            value={selectedSubject || ''}
            onChange={(e) => setSelectedSubject(e.target.value)}
          >
            <option value="">Select Subject</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {selectedClass && selectedSubject ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Student List ({students.length})
                </h3>
                <button 
                  onClick={() => setShowQR(!showQR)}
                  className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  <QrCode className="w-4 h-4" />
                  {showQR ? "Hide QR Code" : "Show QR Code"}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                      <th className="pb-4">Name</th>
                      <th className="pb-4">Email</th>
                      <th className="pb-4 text-center">Status</th>
                      <th className="pb-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {students.map(student => {
                      const record = attendanceRecords.find(a => a.studentId === student.uid);
                      return (
                        <tr key={student.uid} className="group">
                          <td className="py-4 font-medium text-slate-900">{student.name}</td>
                          <td className="py-4 text-slate-500 text-sm">{student.email}</td>
                          <td className="py-4 text-center">
                            <span className={cn(
                              "px-2 py-1 rounded-lg text-xs font-bold uppercase",
                              record?.status === 'present' ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
                            )}>
                              {record?.status || 'absent'}
                            </span>
                          </td>
                          <td className="py-4 text-right">
                            <button 
                              onClick={() => toggleAttendance(student)}
                              className={cn(
                                "p-2 rounded-lg transition-colors",
                                record?.status === 'present' ? "text-red-500 hover:bg-red-50" : "text-blue-500 hover:bg-blue-50"
                              )}
                            >
                              {record?.status === 'present' ? <XCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {showQR && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 text-center"
              >
                <h3 className="font-bold text-slate-800 mb-4">Class QR Code</h3>
                <div className="bg-slate-50 p-4 rounded-xl inline-block mb-4">
                  <QRCodeSVG value={qrValue} size={200} />
                </div>
                <p className="text-xs text-slate-500">Students can scan this to check in</p>
              </motion.div>
            )}

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
              <h3 className="font-bold text-slate-800 mb-4">Attendance Summary</h3>
              <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl mb-4">
                <div>
                  <p className="text-xs font-bold text-blue-600 uppercase">Present</p>
                  <p className="text-2xl font-bold text-blue-900">{attendanceRecords.filter(a => a.status === 'present').length}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase">Absent</p>
                  <p className="text-2xl font-bold text-slate-600 text-right">{students.length - attendanceRecords.filter(a => a.status === 'present').length}</p>
                </div>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-600 h-full transition-all duration-500" 
                  style={{ width: `${(attendanceRecords.filter(a => a.status === 'present').length / (students.length || 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-slate-100 text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <LayoutDashboard className="text-slate-300 w-8 h-8" />
          </div>
          <h3 className="text-slate-900 font-bold text-lg">Select a class and subject</h3>
          <p className="text-slate-500">Choose from the dropdowns above to manage attendance</p>
        </div>
      )}
    </div>
  );
};

// --- Admin Dashboard ---

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'classes' | 'subjects' | 'schedules' | 'reports'>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [subjects, setSubjects] = useState<SubjectData[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });
    const unsubClasses = onSnapshot(collection(db, 'classes'), (snap) => {
      setClasses(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ClassData)));
    });
    const unsubSubjects = onSnapshot(collection(db, 'subjects'), (snap) => {
      setSubjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SubjectData)));
    });
    const unsubAttendance = onSnapshot(collection(db, 'attendance'), (snap) => {
      setAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AttendanceRecord)));
    });
    const unsubSchedules = onSnapshot(collection(db, 'schedules'), (snap) => {
      setSchedules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ScheduleEntry)));
    });

    return () => {
      unsubUsers();
      unsubClasses();
      unsubSubjects();
      unsubAttendance();
      unsubSchedules();
    };
  }, []);

  const handleUpdateUser = async (uid: string, data: Partial<UserProfile>) => {
    await setDoc(doc(db, 'users', uid), data, { merge: true });
  };

  const handleAddClass = async () => {
    const name = prompt('Enter class name (e.g., Grade 10-A):');
    if (name) {
      const id = name.toLowerCase().replace(/\s+/g, '-');
      await setDoc(doc(db, 'classes', id), { id, name });
    }
  };

  const handleAddSubject = async () => {
    const name = prompt('Enter subject name:');
    const code = prompt('Enter subject code:');
    if (name && code) {
      const id = code.toLowerCase();
      await setDoc(doc(db, 'subjects', id), { id, name, code });
    }
  };

  const handleAddSchedule = async () => {
    const classId = prompt('Enter Class ID:');
    const subjectId = prompt('Enter Subject ID:');
    const day = prompt('Enter Day (e.g., Monday):');
    const startTime = prompt('Enter Start Time (e.g., 09:00):');
    const endTime = prompt('Enter End Time (e.g., 10:00):');
    const room = prompt('Enter Room:');

    if (classId && subjectId && day && startTime && endTime) {
      await addDoc(collection(db, 'schedules'), {
        classId,
        subjectId,
        day,
        startTime,
        endTime,
        room: room || 'TBA'
      });
    }
  };

  const reportData = attendance.reduce((acc: any[], curr) => {
    const date = curr.date;
    const existing = acc.find(item => item.date === date);
    if (existing) {
      existing.count += 1;
    } else {
      acc.push({ date, count: 1 });
    }
    return acc;
  }, []).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Admin Panel</h2>
        <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto">
          {(['users', 'classes', 'subjects', 'schedules', 'reports'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold capitalize transition-all whitespace-nowrap",
                activeTab === tab ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Class/Subjects</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u.uid}>
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-900">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <select 
                      className="bg-slate-50 border-none rounded-lg px-2 py-1 text-xs font-bold uppercase"
                      value={u.role}
                      onChange={(e) => handleUpdateUser(u.uid, { role: e.target.value as UserRole })}
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    {u.role === 'student' ? (
                      <select 
                        className="bg-slate-50 border-none rounded-lg px-2 py-1 text-xs"
                        value={u.classId || ''}
                        onChange={(e) => handleUpdateUser(u.uid, { classId: e.target.value })}
                      >
                        <option value="">No Class</option>
                        {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : u.role === 'teacher' ? (
                      <div className="flex flex-wrap gap-1">
                        {subjects.map(s => (
                          <button
                            key={s.id}
                            onClick={() => {
                              const current = u.subjectIds || [];
                              const next = current.includes(s.id) ? current.filter(id => id !== s.id) : [...current, s.id];
                              handleUpdateUser(u.uid, { subjectIds: next });
                            }}
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                              u.subjectIds?.includes(s.id) ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-400"
                            )}
                          >
                            {s.code}
                          </button>
                        ))}
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-slate-400 hover:text-red-500">
                      <XCircle className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'classes' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {classes.map(c => (
            <div key={c.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">{users.filter(u => u.classId === c.id).length} Students</p>
              </div>
              <BookOpen className="text-blue-600 w-6 h-6" />
            </div>
          ))}
          <button 
            onClick={handleAddClass}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-all"
          >
            <Plus className="w-8 h-8" />
            <span className="font-bold">Add Class</span>
          </button>
        </div>
      )}

      {activeTab === 'subjects' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {subjects.map(s => (
            <div key={s.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="px-2 py-1 bg-blue-100 text-blue-600 rounded text-[10px] font-bold uppercase">{s.code}</span>
                <FileText className="text-slate-300 w-5 h-5" />
              </div>
              <p className="font-bold text-slate-900">{s.name}</p>
            </div>
          ))}
          <button 
            onClick={handleAddSubject}
            className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-all"
          >
            <Plus className="w-8 h-8" />
            <span className="font-bold">Add Subject</span>
          </button>
        </div>
      )}

      {activeTab === 'schedules' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button 
              onClick={handleAddSchedule}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-700 transition-all"
            >
              <Plus className="w-5 h-5" /> Add Schedule
            </button>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Class</th>
                  <th className="px-6 py-4">Subject</th>
                  <th className="px-6 py-4">Day</th>
                  <th className="px-6 py-4">Time</th>
                  <th className="px-6 py-4">Room</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedules.map(s => (
                  <tr key={s.id}>
                    <td className="px-6 py-4 font-medium text-slate-900">{classes.find(c => c.id === s.classId)?.name}</td>
                    <td className="px-6 py-4 text-slate-500">{subjects.find(sub => sub.id === s.subjectId)?.name}</td>
                    <td className="px-6 py-4 text-slate-500">{s.day}</td>
                    <td className="px-6 py-4 text-slate-500">{s.startTime} - {s.endTime}</td>
                    <td className="px-6 py-4 text-slate-500">{s.room}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-6">Attendance Trends</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reportData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-800">Detailed Records</h3>
              <button className="text-blue-600 text-sm font-bold hover:underline">Export CSV</button>
            </div>
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Student</th>
                  <th className="px-6 py-4">Subject</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attendance.slice(0, 20).map(a => (
                  <tr key={a.id}>
                    <td className="px-6 py-4 font-medium text-slate-900">{a.studentName}</td>
                    <td className="px-6 py-4 text-slate-500">{subjects.find(s => s.id === a.subjectId)?.name}</td>
                    <td className="px-6 py-4 text-slate-500">{a.date}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-bold uppercase">{a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const unsubProfile = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          }
          setLoading(false);
        });
        return unsubProfile;
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  if (loading) return <LoadingScreen />;
  if (!user) return <Login />;

  const handleLogout = () => signOut(auth);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 lg:relative lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="h-full flex flex-col p-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
              <QrCode className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">EduAttend</h1>
          </div>

          <nav className="flex-1 space-y-2">
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 text-blue-600 rounded-xl font-bold text-sm">
              <LayoutDashboard className="w-5 h-5" />
              Dashboard
            </button>
            {/* Add more nav items here if needed */}
          </nav>

          <div className="mt-auto pt-6 border-t border-slate-100">
            <div className="flex items-center gap-3 mb-6 px-4">
              <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                <User className="text-slate-500 w-5 h-5" />
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold text-slate-900 truncate">{profile?.name || user.displayName}</p>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">{profile?.role}</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl font-bold text-sm transition-all"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 overflow-auto">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 text-slate-500 lg:hidden"
          >
            {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <div className="flex-1 lg:ml-0 ml-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input 
                type="text" 
                placeholder="Search anything..." 
                className="w-full bg-slate-50 border-none rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-right">
              <p className="text-xs font-bold text-slate-400 uppercase">{format(new Date(), 'EEEE')}</p>
              <p className="text-sm font-bold text-slate-900">{format(new Date(), 'MMM dd, yyyy')}</p>
            </div>
          </div>
        </header>

        <div className="p-6 max-w-7xl mx-auto">
          {profile?.role === 'student' && <StudentDashboard user={profile} />}
          {profile?.role === 'teacher' && <TeacherDashboard user={profile} />}
          {profile?.role === 'admin' && <AdminDashboard />}
          
          {!profile && !loading && (
            <div className="text-center py-20">
              <p className="text-slate-500">Setting up your profile...</p>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}
