import cStringIO
import sys

win32file = None
if sys.platform == 'win32':
    try:
        import ntsecuritycon
        import win32api
        import win32file
    except Exception:
        pass


class OpenWithoutCaching():
    """
    This mimics enough of the python file class to work with continuous read or
    written files.  It marks the file to avoid caching in the operating system,
    which speeds up access as it doesn't need to keep it in memory.  Use in
    place of open(name[, mode]).
    """
    def __init__(self, name, mode='rb'):
        self.fptr = None
        self.fileType = 'python'
        self.linebuf = []
        if sys.platform == 'win32' and win32file:
            if 'w' in mode or 'a' in mode:
                self.fptr = win32file.CreateFile(
                    name, win32file.GENERIC_WRITE, 0, None,
                    win32file.CREATE_ALWAYS,
                    win32file.FILE_FLAG_SEQUENTIAL_SCAN, 0)
            else:
                self.fptr = win32file.CreateFile(
                    name, win32file.GENERIC_READ, 0, None,
                    win32file.OPEN_EXISTING,
                    win32file.FILE_FLAG_SEQUENTIAL_SCAN, 0)
            self.fileType = 'win32'
        else:
            self.fptr = open(name, mode)
            # if linux, add fadvise here

    def __del__(self):
        self.close()

    def __iter__(self):
        return self

    def __next__(self):
        if self.fileType == 'win32':
            line = self.readline()
            if not line:
                raise StopIteration
            return line
        else:
            return self.fptr.next()

    def next(self):
        return self.__next__()

    def close(self):
        if not self.fptr:
            return
        if self.fileType == 'win32':
            self.fptr.Close()
        else:
            self.fptr.close()
        self.fptr = None

    def read(self, readlen=None):
        if self.fileType == 'win32':
            if readlen is None:
                data = []
                while True:
                    rc, buffer = win32file.ReadFile(self.fptr, 1024 * 1024)
                    if rc or not len(buffer):
                        break
                    data.append(buffer)
                return "".join(data)
            else:
                rc, buffer = win32file.ReadFile(self.fptr, readlen)
                return buffer
        else:
            return self.fptr.read(readlen)

    def readline(self):
        if self.fileType == 'win32':
            while len(self.linebuf) <= 1:
                more = self.read(256 * 1024)
                self.linebuf = cStringIO.StringIO(
                    ''.join(self.linebuf) + more).readlines()
                if more == '':
                    break
            if not len(self.linebuf):
                return None
            return self.linebuf.pop(0)
        else:
            return self.fptr.readline()

    def readlines(self, sizehint=None):
        return cStringIO.StringIO(self.read()).readlines()

    def write(self, data):
        if self.fileType == 'win32':
            win32file.WriteFile(self.fptr, data)
        else:
            return self.fptr.write(data)

    def tell(self):
        if self.fileType == 'win32':
            return win32file.SetFilePointer(self.fptr, 0,
                                            win32file.FILE_CURRENT)
        else:
            return self.fptr.tell()


def clearFileCache(verbose=True):
    """
    Clear the file system cache in Windows or linux.  In linux, you must have
    superuser permission.  In Windows, you must had admin privilege.

    :param verbose: if True, print information if a drive can't be fully
                    cleared.
    """
    if sys.platform == 'win32':
        drives = win32api.GetLogicalDriveStrings()
        drives = drives.split('\0')[:-1]
        for drive in drives:
            path = '\\\\.\\' + drive[:2]
            try:
                handle = win32file.CreateFile(
                    path, ntsecuritycon.FILE_READ_DATA,
                    win32file.FILE_SHARE_READ, None, win32file.OPEN_EXISTING,
                    0, None)
                handle.close()
            except Exception as exc:
                if verbose:
                    print 'Failed for', path, exc
    else:
        open('/proc/sys/vm/drop_caches', 'wb').write('3')
