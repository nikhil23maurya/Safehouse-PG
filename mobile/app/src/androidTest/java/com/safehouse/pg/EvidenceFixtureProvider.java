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
 private File fixture;
 public boolean onCreate(){
  // File-backed blobs snapshot the file size and modification time. Do not
  // rewrite the image on each open: that makes a selected file unreadable.
  try{fixture=new File(getContext().getCacheDir(),"synthetic-evidence.png");try(InputStream in=getContext().getAssets().open("qr-fixture.png");OutputStream out=new FileOutputStream(fixture)){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}return true;}catch(IOException e){return false;}
 }
 public String getType(Uri uri){return "image/png";}
 public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){MatrixCursor c=new MatrixCursor(new String[]{"_display_name","_size"});c.addRow(new Object[]{"synthetic-evidence.png",fixture.length()});return c;}
 public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
  if(!"r".equals(mode)||!"/photo".equals(uri.getPath()))throw new FileNotFoundException("Only the synthetic image is readable");
  return ParcelFileDescriptor.open(fixture,ParcelFileDescriptor.MODE_READ_ONLY);
 }
 public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
 public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
 public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
}
