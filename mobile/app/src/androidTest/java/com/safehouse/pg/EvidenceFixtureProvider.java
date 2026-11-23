package com.safehouse.pg;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.*;

/** Synthetic evidence available only in the instrumentation APK. */
public class EvidenceFixtureProvider extends ContentProvider {
 public boolean onCreate(){return true;}
 public String getType(Uri uri){return "image/png";}
 public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){MatrixCursor c=new MatrixCursor(new String[]{"_display_name","_size"});long size=0;try(InputStream in=getContext().getAssets().open("qr-fixture.png")){size=in.available();}catch(IOException ignored){}c.addRow(new Object[]{"synthetic-evidence.png",size});return c;}
 public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  try{File f=new File(getContext().getCacheDir(),"synthetic-evidence.png");try(InputStream in=getContext().getAssets().open("qr-fixture.png");OutputStream out=new FileOutputStream(f)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}return ParcelFileDescriptor.open(f,ParcelFileDescriptor.MODE_READ_ONLY);}catch(IOException e){throw new FileNotFoundException(e.getMessage());}
 }
 public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
 public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
 public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
}
